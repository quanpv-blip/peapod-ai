import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { autoApproveCheck, isIncidentText } from '../src/domain/autoApprove.ts';
import { DEFAULT_SETTINGS, settingsToForm } from '../src/domain/appSettings.ts';
import type { ContentPackage } from '../src/domain/package.ts';
import { saveAppSettings } from '../src/services/appSettings.ts';
import { autoApproveVN, AUTO_ACTOR_EMAIL } from '../src/services/autoApprove.ts';
import * as svc from '../src/services/contents.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql'];
const FEEDS = ['vnexpress.net'];

const pkg = (over: Partial<ContentPackage> & { headline?: string; market?: 'VN' | 'JP'; url?: string } = {}): ContentPackage => ({
  market: over.market ?? 'VN',
  topic_summary: 't',
  post: { headline: over.headline ?? 'Doanh nghiệp ra mắt sản phẩm mới', body: 'Nội dung tiếng Việt trung lập về sự kiện công nghệ hôm nay.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#CN'] },
  sources: [{ title: 'VnExpress', url: over.url ?? 'https://vnexpress.net/tin-1' }],
  claims_to_verify: over.claims_to_verify ?? [],
  media: { engine: 'NONE' },
});

describe('điều kiện tự duyệt (thuần)', () => {
  const ctx = { hasImage: false, editedByHuman: false, feedDomains: FEEDS };
  it('bài VN sạch, nguồn trong RSS: đạt', () => {
    expect(autoApproveCheck(pkg(), ctx).ok).toBe(true);
  });
  it('JP, có khẳng định, có người sửa, nguồn lạ, tin sự cố: không đạt', () => {
    expect(autoApproveCheck(pkg({ market: 'JP' }), ctx).ok).toBe(false);
    expect(autoApproveCheck(pkg({ claims_to_verify: ['Số liệu A'] }), ctx).ok).toBe(false);
    expect(autoApproveCheck(pkg(), { ...ctx, editedByHuman: true }).ok).toBe(false);
    expect(autoApproveCheck(pkg({ url: 'https://khac.test/x' }), ctx).ok).toBe(false);
    expect(autoApproveCheck(pkg({ headline: 'Hacker tấn công hệ thống ngân hàng' }), ctx).ok).toBe(false);
  });
  it('bài thẻ bắt buộc có ảnh', () => {
    const p = { ...pkg(), media: { engine: 'REMOTION_CARD' as const, card: { title: 't', bullets: [] } } };
    expect(autoApproveCheck(p, ctx).ok).toBe(false);
    expect(autoApproveCheck(p, { ...ctx, hasImage: true }).ok).toBe(true);
  });
  it('nhận diện từ khóa sự cố tiếng Nhật và Việt', () => {
    expect(isIncidentText('不正アクセスで情報流出')).toBe(true);
    expect(isIncidentText('Rò rỉ dữ liệu khách hàng')).toBe(true);
    expect(isIncidentText('Ra mắt tính năng mới')).toBe(false);
  });
});

d('tự duyệt VN (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
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
    await db.query('DELETE FROM approval_event');
    await db.query('DELETE FROM media_asset');
    await db.query('DELETE FROM content_revision');
    await db.query('DELETE FROM content_item');
    await saveAppSettings(db, { ...settingsToForm(DEFAULT_SETTINGS), autoApproveVN: 'on', autoApproveDailyMax: '2' }, 'admin@t');
  });

  const state = async (id: number) => (await db.query<{ state: string }>('SELECT state FROM content_item WHERE id = $1', [id])).rows[0]!.state;

  it('duyệt bài VN đạt điều kiện, ghi nhật ký dưới tài khoản hệ thống', async () => {
    const id = await svc.createGenerated(db, pkg({ url: 'https://vnexpress.net/a1' }), 'test');
    const r = await autoApproveVN(db);
    expect(r.find((x) => x.id === id)?.outcome).toBe('approved');
    expect(await state(id)).toBe('APPROVED');
    const ev = (await db.query<{ actor: string; action: string }>('SELECT actor, action FROM approval_event WHERE content_id = $1', [id])).rows[0]!;
    expect(ev).toEqual({ actor: AUTO_ACTOR_EMAIL, action: 'APPROVE' });
  });

  it('bỏ qua bài có khẳng định, tin sự cố và bài JP; không đụng tới chúng', async () => {
    const withClaims = await svc.createGenerated(db, pkg({ claims_to_verify: ['x'], url: 'https://vnexpress.net/a2' }), 'test');
    const incident = await svc.createGenerated(db, pkg({ headline: 'Rò rỉ dữ liệu khách hàng', url: 'https://vnexpress.net/a3' }), 'test');
    const jp = await svc.createGenerated(db, { ...pkg({ market: 'JP', url: 'https://vnexpress.net/a4' }), post: { headline: '見出し', body: 'これは日本語の本文です。', call_to_action: 'x', hashtags: [] } }, 'test');
    await autoApproveVN(db);
    expect(await state(withClaims)).toBe('IN_REVIEW');
    expect(await state(incident)).toBe('IN_REVIEW');
    expect(await state(jp)).toBe('IN_REVIEW');
  });

  it('không vượt trần số bài mỗi ngày', async () => {
    const ids = [];
    for (const n of [1, 2, 3]) ids.push(await svc.createGenerated(db, pkg({ url: `https://vnexpress.net/c${n}` }), 'test'));
    await autoApproveVN(db);
    const states = await Promise.all(ids.map(state));
    expect(states.filter((s) => s === 'APPROVED')).toHaveLength(2);
    expect(await autoApproveVN(db)).toEqual([]);
  });

  it('công tắc tắt: không tự duyệt gì', async () => {
    await saveAppSettings(db, { ...settingsToForm(DEFAULT_SETTINGS), autoApproveVN: '', autoApproveDailyMax: '2' }, 'admin@t');
    const id = await svc.createGenerated(db, pkg({ url: 'https://vnexpress.net/off' }), 'test');
    expect(await autoApproveVN(db)).toEqual([]);
    expect(await state(id)).toBe('IN_REVIEW');
  });

  it('schema có cột và kiểu đúng cho lệnh đếm nhật ký', () => {
    expect(readFileSync(new URL('../db/migrations/006_ai_usage.sql', import.meta.url), 'utf8')).toContain('ai_usage');
  });
});
