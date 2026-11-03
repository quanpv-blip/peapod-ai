// Tích hợp các chức năng vận hành mới trên PostgreSQL thật: công tắc tạm dừng, người dùng, sinh bản tin, tìm kiếm.
// Bỏ qua nếu không có TEST_DATABASE_URL.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers/freshDb.ts';
import { verifyPassword, type Actor } from '../src/auth.ts';
import { packageHash, type ContentPackage } from '../src/domain/package.ts';
import type { FeedItem } from '../src/domain/rss.ts';
import type { GeminiClient } from '../src/providers/gemini.ts';
import type { MetaClient } from '../src/providers/meta.ts';
import { generateNews } from '../src/services/generate.ts';
import * as svc from '../src/services/contents.ts';
import { publishApproved, publishOne, type PublisherDeps } from '../src/services/publish.ts';
import { isPaused, setPaused } from '../src/services/settings.ts';
import { createUser, listUsers, resetPassword, setDisabled } from '../src/services/users.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql'];

const vn: Actor = { email: 'vn@t', name: 'VN', roles: ['approver_vn'] };
const admin: Actor = { email: 'ad@t', name: 'Admin', roles: ['admin'] };
const future = (min: number) => new Date(Date.now() + min * 60_000);
const ok = (json: unknown) => ({ status: 200, json, headers: new Headers() });
const schema = JSON.parse(readFileSync(new URL('../schemas/content_package.schema.json', import.meta.url), 'utf8')).schema as object;

const pkg = (url: string, headline = 'Tiêu đề thử'): ContentPackage => ({
  market: 'VN',
  topic_summary: 'tóm tắt',
  post: { headline, body: 'Đây là nội dung tiếng Việt để kiểm thử sinh bản tin.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#DX'] },
  sources: [{ title: 'Nguồn', url }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});

d('chức năng vận hành (PostgreSQL thật)', () => {
  let drop: (() => Promise<void>) | undefined;  let db: pg.Pool;
  let mock: { postFeed: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; deletePost: ReturnType<typeof vi.fn> };
  let deps: PublisherDeps;

  beforeAll(async () => {
    const fresh = await freshDb(URL_!, MIGRATIONS);
    db = fresh.db;
    drop = fresh.drop;
  });
  afterAll(async () => {
    await drop?.();
  });
  beforeEach(async () => {
    await db.query('DELETE FROM app_config');
    mock = {
      postFeed: vi.fn(async () => ok({ id: 'PG_X' })),
      get: vi.fn(async () => ok({ id: 'PG_X', is_published: false })),
      deletePost: vi.fn(async () => ok({ success: true })),
    };
    deps = { db, meta: mock as unknown as MetaClient, pages: { VN: { id: 'PG1', token: 'T' } } };
  });

  async function approvedItem(url = 'https://example.com/x'): Promise<number> {
    const p = pkg(url);
    const id = await svc.createGenerated(db, p, 'test');
    await svc.approve(db, vn, id, { revision: 1, packageHash: packageHash(p), scheduledAt: future(180), claimsConfirmed: true });
    return id;
  }

  describe('công tắc tạm dừng', () => {
    it('bật: không hẹn bài mới, không gọi Meta; tắt: hoạt động lại', async () => {
      const id = await approvedItem();
      await setPaused(db, true, 'admin@t');
      expect(await isPaused(db)).toBe(true);
      expect((await publishOne(deps, id)).outcome).toBe('skipped');
      expect((await publishApproved(deps)).map((r) => r.outcome)).toEqual(['skipped']);
      expect(mock.postFeed).not.toHaveBeenCalled();

      await setPaused(db, false, 'admin@t');
      expect((await publishOne(deps, id)).outcome).toBe('scheduled');
    });

    it('bật: sinh bản tin cũng bị chặn', async () => {
      await setPaused(db, true, 'admin@t');
      const gemini = { generateJson: vi.fn() } as unknown as GeminiClient;
      const out = await generateNews({ db, gemini, schema, fetchItems: async () => [{ title: 'A', url: 'https://x.test/a', summary: '' }] }, { market: 'VN', limit: 1, model: 'm' });
      expect(out[0]!.detail).toContain('Công tắc tạm dừng');
      expect(gemini.generateJson).not.toHaveBeenCalled();
    });
  });

  describe('sinh bản tin', () => {
    const items: FeedItem[] = [{ title: 'Tin A', url: 'https://x.test/a', summary: 'tóm tắt' }];
    const gemini = (p: ContentPackage) => ({ generateJson: vi.fn(async () => ({ json: p, usage: { inputTokens: 1, outputTokens: 1, thoughtTokens: 0 } })) }) as unknown as GeminiClient;

    it('tạo bài IN_REVIEW từ mục RSS; lần sau không tạo lại cùng nguồn', async () => {
      const g = gemini(pkg('https://x.test/a'));
      const first = await generateNews({ db, gemini: g, schema, fetchItems: async () => items }, { market: 'VN', limit: 1, model: 'm' });
      expect(first[0]!.outcome).toBe('created');
      const state = (await db.query("SELECT state FROM content_item WHERE id = $1", [first[0]!.id])).rows[0].state;
      expect(state).toBe('IN_REVIEW');

      const second = await generateNews({ db, gemini: g, schema, fetchItems: async () => items }, { market: 'VN', limit: 1, model: 'm' });
      expect(second).toEqual([]);
    });

    it('nguồn ngoài RSS bị bỏ qua', async () => {
      // Mục RSS mới (URL khác) nhưng AI trả nguồn lạ: phải bị loại.
      const g = gemini(pkg('https://evil.test/z'));
      const fresh: FeedItem[] = [{ title: 'Tin B', url: 'https://x.test/b', summary: '' }];
      const out = await generateNews({ db, gemini: g, schema, fetchItems: async () => fresh }, { market: 'VN', limit: 1, model: 'm' });
      expect(out[0]!.outcome).toBe('skipped');
      expect(out[0]!.detail).toContain('nguồn');
    });
  });

  describe('người dùng', () => {
    it('tạo tài khoản: mật khẩu băm được xác minh; trùng email bị chặn; vai trò phải hợp lệ', async () => {
      const { password } = await createUser(db, { email: 'New@Demo.vn', name: 'Mới', roles: ['approver_vn'] });
      const row = (await db.query<{ password_hash: string; email: string }>('SELECT password_hash, email FROM app_user WHERE email = $1', ['new@demo.vn'])).rows[0]!;
      expect(row.email).toBe('new@demo.vn');
      expect(verifyPassword(password, row.password_hash)).toBe(true);
      expect(row.password_hash).not.toContain(password);

      await expect(createUser(db, { email: 'new@demo.vn', name: 'X', roles: ['viewer'] })).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(createUser(db, { email: 'khong-hop-le', name: 'X', roles: ['viewer'] })).rejects.toMatchObject({ code: 'INVALID' });
      await expect(createUser(db, { email: 'a@b.vn', name: 'X', roles: ['superuser'] })).rejects.toMatchObject({ code: 'INVALID' });
    });

    it('khóa có hiệu lực; không tự khóa mình; đặt lại mật khẩu đổi hash', async () => {
      await createUser(db, { email: 'k@demo.vn', name: 'K', roles: ['viewer'] });
      await setDisabled(db, 'k@demo.vn', true, 'ad@t');
      expect((await listUsers(db)).find((u) => u.email === 'k@demo.vn')!.disabled).toBe(true);
      await expect(setDisabled(db, 'ad@t', true, 'ad@t')).rejects.toMatchObject({ code: 'INVALID' });

      const before = (await db.query('SELECT password_hash FROM app_user WHERE email = $1', ['k@demo.vn'])).rows[0].password_hash;
      const { password } = await resetPassword(db, 'k@demo.vn');
      const after = (await db.query('SELECT password_hash FROM app_user WHERE email = $1', ['k@demo.vn'])).rows[0].password_hash;
      expect(after).not.toBe(before);
      expect(verifyPassword(password, after)).toBe(true);
    });
  });

  describe('tìm kiếm hàng chờ', () => {
    it('lọc theo tiêu đề bản hiện tại, không phân biệt hoa thường', async () => {
      const id = await svc.createGenerated(db, pkg('https://x.test/s', 'Alpha Beta mới'), 'test');
      const hit = await svc.listContents(db, admin, { q: 'alpha beta' });
      expect(hit.map((r) => Number(r.id))).toContain(id);
      expect(await svc.listContents(db, admin, { q: 'không-có-chuỗi-này' })).toEqual([]);
    });
  });
});
