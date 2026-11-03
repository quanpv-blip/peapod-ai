// Tích hợp các chức năng vận hành mới trên PostgreSQL thật (cơ sở dữ liệu tạm riêng): cài đặt, trần chi phí,
// chiến dịch, ảnh thẻ, đăng ảnh, tạm dừng do lượt gọi Meta, đổi mật khẩu, chu kỳ nền. Bỏ qua nếu không có TEST_DATABASE_URL.
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyPassword, hashPassword, type Actor } from '../src/auth.ts';
import { DEFAULT_SETTINGS, settingsToForm } from '../src/domain/appSettings.ts';
import { packageHash, type ContentPackage } from '../src/domain/package.ts';
import type { FeedItem } from '../src/domain/rss.ts';
import type { GeminiClient } from '../src/providers/gemini.ts';
import type { MetaClient } from '../src/providers/meta.ts';
import { runCycle } from '../src/jobs/cycle.ts';
import { changeOwnPassword } from '../src/services/account.ts';
import { getAppSettings, saveAppSettings, setFlag } from '../src/services/appSettings.ts';
import { costSummary, recordUsage } from '../src/services/costs.ts';
import * as svc from '../src/services/contents.ts';
import { generateCampaign, generateNews, storeCard } from '../src/services/generate.ts';
import { publishOne, reconcileScheduled, type PublisherDeps, BUC_UNTIL_KEY } from '../src/services/publish.ts';
import { setPaused } from '../src/services/settings.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql'];

const vn: Actor = { email: 'vn@t', name: 'VN', roles: ['approver_vn'] };
const future = (min: number) => new Date(Date.now() + min * 60_000);
const ok = (json: unknown, headers: Record<string, string> = {}) => ({ status: 200, json, headers: new Headers(headers) });
const schema = JSON.parse(readFileSync(new URL('../schemas/content_package.schema.json', import.meta.url), 'utf8')).schema as object;
const MEDIA = mkdtempSync(path.join(os.tmpdir(), 'pp-media-'));

const cardPkg = (url = 'https://example.com/card'): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline: 'Tin có thẻ', body: 'Nội dung tiếng Việt của bài có ảnh thẻ.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#DX'] },
  sources: [{ title: 'Nguồn', url }],
  claims_to_verify: [],
  media: { engine: 'REMOTION_CARD', card: { title: 'Tin có thẻ', bullets: ['Điểm một', 'Điểm hai'] } },
});

d('vận hành (PostgreSQL thật)', () => {
  let db: import('pg').Pool;
  let drop: () => Promise<void>;
  let mock: { postFeed: ReturnType<typeof vi.fn>; postPhoto: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; deletePost: ReturnType<typeof vi.fn> };
  let deps: PublisherDeps;

  beforeAll(async () => {
    const f = await freshDb(URL_!, MIGRATIONS);
    db = f.db;
    drop = f.drop;
  });
  afterAll(async () => {
    await drop?.();
  });
  beforeEach(async () => {
    await db.query('DELETE FROM app_config');
    await db.query('DELETE FROM ai_usage');
    mock = {
      postFeed: vi.fn(async () => ok({ id: 'FEED_1' })),
      postPhoto: vi.fn(async () => ok({ id: 'PHOTO_1', post_id: 'PAGE_POST_1' })),
      get: vi.fn(async () => ok({ id: 'x', is_published: false })),
      deletePost: vi.fn(async () => ok({ success: true })),
    };
    deps = { db, meta: mock as unknown as MetaClient, pages: { VN: { id: 'PG1', token: 'T' } } };
  });

  const approve = async (p: ContentPackage): Promise<number> => {
    const id = await svc.createGenerated(db, p, 'test');
    await svc.approve(db, vn, id, { revision: 1, packageHash: packageHash(p), scheduledAt: future(180), claimsConfirmed: true });
    return id;
  };

  describe('cài đặt', () => {
    it('lưu rồi đọc lại; sai thì không ghi gì', async () => {
      const bad = await saveAppSettings(db, { ...settingsToForm(DEFAULT_SETTINGS), dailyCapUsd: 'x' }, 'admin@t');
      expect(bad.ok).toBe(false);
      expect((await getAppSettings(db)).dailyCapUsd).toBe(DEFAULT_SETTINGS.dailyCapUsd);

      const good = await saveAppSettings(db, { ...settingsToForm(DEFAULT_SETTINGS), dailyCapUsd: '5', genTimeVN: '06:30' }, 'admin@t');
      expect(good.ok).toBe(true);
      const s = await getAppSettings(db);
      expect(s.dailyCapUsd).toBe(5);
      expect(s.genTime.VN).toBe('06:30');
    });
  });

  describe('chi phí và trần', () => {
    it('ghi chi phí; khi đạt trần ngày thì không gọi AI nữa', async () => {
      await saveAppSettings(db, { ...settingsToForm(DEFAULT_SETTINGS), dailyCapUsd: '0.01' }, 'admin@t');
      await recordUsage(db, { market: 'VN', purpose: 'NEWS', model: 'm', usage: { inputTokens: 1, outputTokens: 1, thoughtTokens: 0 }, costUsd: 0.02 });
      const gemini = { generateJson: vi.fn() } as unknown as GeminiClient;
      const out = await generateNews({ db, gemini, schema, mediaDir: MEDIA, fetchItems: async () => [{ title: 'A', url: 'https://x.test/a', summary: '' }] }, { market: 'VN', limit: 1, model: 'm' });
      expect(out[0]!.detail).toContain('trần ngày');
      expect(gemini.generateJson).not.toHaveBeenCalled();
      const sum = await costSummary(db);
      expect(sum.todayUsd).toBeCloseTo(0.02, 6);
    });

    it('sinh bản tin ghi chi phí theo đơn giá cấu hình', async () => {
      await saveAppSettings(db, { ...settingsToForm(DEFAULT_SETTINGS), priceInPerM: '1', priceOutPerM: '2' }, 'admin@t');
      const p = { ...cardPkg('https://x.test/n1'), media: { engine: 'NONE' as const } };
      const gemini = { generateJson: vi.fn(async () => ({ json: p, usage: { inputTokens: 1_000_000, outputTokens: 0, thoughtTokens: 0 }, text: '', raw: null })) } as unknown as GeminiClient;
      const out = await generateNews({ db, gemini, schema, mediaDir: MEDIA, fetchItems: async () => [{ title: 'Tin', url: 'https://x.test/n1', summary: 'tóm tắt' }] }, { market: 'VN', limit: 1, model: 'm' });
      expect(out[0]!.outcome).toBe('created');
      const sum = await costSummary(db);
      expect(sum.byModel[0]!.costUsd).toBeCloseTo(1, 6);
    });
  });

  describe('chiến dịch', () => {
    it('từ chối nguồn ngoài miền được phép và nội dung quá ngắn; nhận nguồn hợp lệ', async () => {
      const gemini = { generateJson: vi.fn() } as unknown as GeminiClient;
      const base = { db, gemini, schema, mediaDir: MEDIA };
      const long = 'Nội dung nguồn đủ dài để qua kiểm tra độ dài tối thiểu của hệ thống. '.repeat(3);
      const a = await generateCampaign(base, { market: 'VN', topic: 'T', sourceUrl: 'https://tin-la.test/x', sourceText: long, model: 'm' });
      expect(a.detail).toContain('miền được phép');
      const b = await generateCampaign(base, { market: 'VN', topic: 'T', sourceUrl: 'https://vnexpress.net/x', sourceText: 'ngắn', model: 'm' });
      expect(b.detail).toContain('quá ngắn');
      expect(gemini.generateJson).not.toHaveBeenCalled();
    });
  });

  describe('ảnh thẻ và đăng ảnh', () => {
    it('lưu PNG vào thư mục media và ghi media_asset', async () => {
      const id = await svc.createGenerated(db, cardPkg(), 'test');
      const file = await storeCard(db, MEDIA, id, 1, cardPkg());
      expect(file.endsWith(`${id}-r1.png`)).toBe(true);
      const row = (await db.query("SELECT kind, width, height FROM media_asset WHERE content_id = $1", [id])).rows[0];
      expect(row).toMatchObject({ kind: 'IMAGE', width: 1080, height: 1350 });
    });

    it('bài có thẻ đăng bằng ảnh (postPhoto) và lưu post_id để đối soát', async () => {
      const p = cardPkg('https://example.com/img1');
      const id = await approve(p);
      await storeCard(db, MEDIA, id, 1, p);
      const r = await publishOne(deps, id);
      expect(r.outcome).toBe('scheduled');
      expect(mock.postPhoto).toHaveBeenCalledTimes(1);
      expect(mock.postFeed).not.toHaveBeenCalled();
      expect((await db.query('SELECT fb_post_id FROM content_item WHERE id = $1', [id])).rows[0].fb_post_id).toBe('PAGE_POST_1');
    });

    it('bài cần thẻ nhưng thiếu ảnh: không đăng văn bản thay thế, trả về để dựng lại', async () => {
      const id = await approve(cardPkg('https://example.com/img2'));
      const r = await publishOne(deps, id);
      expect(r.outcome).toBe('returned');
      expect(mock.postFeed).not.toHaveBeenCalled();
      expect(mock.postPhoto).not.toHaveBeenCalled();
    });
  });

  describe('lượt gọi Meta (BUC)', () => {
    it('vượt ngưỡng thì tạm dừng hẹn bài mới đến hết thời gian', async () => {
      await saveAppSettings(db, { ...settingsToForm(DEFAULT_SETTINGS), bucPausePct: '50' }, 'admin@t');
      const p = { ...cardPkg('https://example.com/buc1'), media: { engine: 'NONE' as const } };
      const id1 = await approve(p);
      mock.postFeed.mockResolvedValueOnce(ok({ id: 'F1' }, { 'x-business-use-case-usage': JSON.stringify({ '1': [{ call_count: 90 }] }) }));
      expect((await publishOne(deps, id1)).outcome).toBe('scheduled');
      expect(Number(await (await import('../src/services/appSettings.ts')).getFlag(db, BUC_UNTIL_KEY))).toBeGreaterThan(Date.now());

      const p2 = { ...cardPkg('https://example.com/buc2'), media: { engine: 'NONE' as const } };
      const id2 = await approve(p2);
      const r2 = await publishOne(deps, id2);
      expect(r2.outcome).toBe('skipped');
      expect(r2.detail).toContain('BUC');
      expect(mock.postFeed).toHaveBeenCalledTimes(1);
    });
  });

  describe('đổi mật khẩu', () => {
    it('cần đúng mật khẩu hiện tại, mật khẩu mới đủ dài và khác cũ', async () => {
      await db.query("INSERT INTO app_user(email, display_name, roles, password_hash) VALUES ('u@t', 'U', ARRAY['viewer'], $1)", [hashPassword('mat-khau-cu-123')]);
      await expect(changeOwnPassword(db, 'u@t', 'sai', 'mat-khau-moi-456')).rejects.toMatchObject({ code: 'INVALID' });
      await expect(changeOwnPassword(db, 'u@t', 'mat-khau-cu-123', 'ngan')).rejects.toMatchObject({ code: 'INVALID' });
      await expect(changeOwnPassword(db, 'u@t', 'mat-khau-cu-123', 'mat-khau-cu-123')).rejects.toMatchObject({ code: 'INVALID' });
      await changeOwnPassword(db, 'u@t', 'mat-khau-cu-123', 'mat-khau-moi-456');
      const h = (await db.query<{ password_hash: string }>("SELECT password_hash FROM app_user WHERE email = 'u@t'")).rows[0]!.password_hash;
      expect(verifyPassword('mat-khau-moi-456', h)).toBe(true);
    });
  });

  describe('chu kỳ nền', () => {
    it('đang tạm dừng thì không làm gì; sinh bản tin đúng một lần mỗi ngày theo giờ cấu hình', async () => {
      await setPaused(db, true, 'admin@t');
      expect(await runCycle({ db, notify: async () => undefined })).toEqual(['công tắc tạm dừng đang bật: bỏ qua chu kỳ']);
      await setPaused(db, false, 'admin@t');

      // 2026-11-03 01:00 UTC = 08:00 ICT: đã qua 07:00 nên chạy; JP 10:00 JST cũng đã qua 07:00.
      const now = new Date('2026-11-03T01:00:00Z');
      const fetchItems = async (): Promise<FeedItem[]> => [];
      const gemini = { generateJson: vi.fn() } as unknown as GeminiClient;
      const generator = { gemini, schema, mediaDir: MEDIA, model: 'm' };
      const first = await runCycle({ db, generator, notify: async () => undefined, now: () => now });
      expect(first.join(' ')).toMatch(/sinh VN/);
      void fetchItems;
      const again = await runCycle({ db, generator, notify: async () => undefined, now: () => now });
      expect(again).toEqual(['không có việc cần làm']);
      expect(await (await import('../src/services/appSettings.ts')).getFlag(db, 'gen_last_VN')).toBe('2026-11-03');
    });

    it('đối soát bỏ qua bài chưa tới lúc kiểm tra', async () => {
      const r = await reconcileScheduled(deps);
      expect(r).toEqual([]);
    });
  });

  it('cờ dùng chung (setFlag) ghi đè được', async () => {
    await setFlag(db, 'k', '1');
    await setFlag(db, 'k', '2', 'x');
    expect((await db.query("SELECT value FROM app_config WHERE key = 'k'")).rows[0].value).toBe('2');
    expect(readFileSync(new URL('../db/migrations/006_ai_usage.sql', import.meta.url), 'utf8')).toContain('ai_usage');
  });
});
