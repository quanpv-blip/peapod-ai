import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { DEFAULT_SETTINGS, type AppSettings } from '../src/domain/appSettings.ts';
import type { ContentPackage } from '../src/domain/package.ts';
import { setFlag } from '../src/services/appSettings.ts';
import { AI_HIT_PREFIX, markAiExhausted, quotaReport } from '../src/services/quota.ts';
import { BUC_UNTIL_KEY } from '../src/services/publish.ts';
import * as svc from '../src/services/contents.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql'];
const MODELS = ['gemini-test-a', 'gemini-test-b'];

const settings = (over: Partial<AppSettings> = {}): AppSettings => ({ ...DEFAULT_SETTINGS, aiRequestLimit: 20, aiCreditUsd: 0, aiCreditAsOf: '', ...over });
const todayIct = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 3_600_000);

const pkg = (url: string): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline: 'Doanh nghiệp ra mắt sản phẩm mới', body: 'Nội dung tiếng Việt trung lập về sự kiện công nghệ hôm nay.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#CN'] },
  sources: [{ title: 'VnExpress', url }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});

d('hạn mức, credit và giới hạn Meta (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
  let savedModels: string | undefined;

  beforeAll(async () => {
    const f = await freshDb(URL_!, MIGRATIONS);
    db = f.db;
    drop = f.drop;
    savedModels = process.env.GEMINI_MODELS;
    process.env.GEMINI_MODELS = MODELS.join(',');
  });
  afterAll(async () => {
    if (savedModels === undefined) delete process.env.GEMINI_MODELS;
    else process.env.GEMINI_MODELS = savedModels;
    await drop?.();
  });
  beforeEach(async () => {
    await db.query('DELETE FROM app_config');
    await db.query('DELETE FROM approval_event');
    await db.query('DELETE FROM media_asset');
    await db.query('DELETE FROM content_revision');
    await db.query('DELETE FROM content_item');
    await db.query('DELETE FROM ai_usage');
  });

  it('mô hình đã báo hết hạn mức trong ngày: đánh dấu và không cho tạo bài', async () => {
    for (const m of MODELS) await markAiExhausted(db, m);
    const r = await quotaReport(db, settings(), { metaConfigured: true });
    expect(r.models.every((m) => m.hitToday)).toBe(true);
    expect(r.verdict.canGenerate).toBe(false);
    expect(r.verdict.generateReason).toContain('Reset lúc');
  });

  it('chỉ một mô hình hết: vẫn cho tạo bài bằng mô hình còn lại', async () => {
    await markAiExhausted(db, MODELS[0]!);
    const r = await quotaReport(db, settings(), { metaConfigured: true });
    expect(r.verdict.canGenerate).toBe(true);
  });

  it('đếm lượt theo mô hình trong ngày, bỏ qua lượt cũ', async () => {
    await db.query(
      `INSERT INTO ai_usage (market, purpose, model, cost_usd, created_at) VALUES
       ('VN','NEWS',$1,0.01,now()), ('VN','NEWS',$1,0.01,now()), ('VN','NEWS',$1,0.01,now()), ('VN','NEWS',$1,0.01,$2)`,
      [MODELS[0], daysAgo(3)],
    );
    const r = await quotaReport(db, settings(), { metaConfigured: true });
    const a = r.models.find((m) => m.model === MODELS[0])!;
    expect(a.calls).toBe(3);
    expect(a.view).toMatchObject({ state: 'con', label: 'Còn 17/20' });
  });

  it('credit: chỉ trừ chi phí phát sinh từ ngày nhập số dư', async () => {
    await db.query(
      `INSERT INTO ai_usage (market, purpose, model, cost_usd, created_at) VALUES
       ('VN','NEWS',$1,2.0,$2), ('VN','NEWS',$1,1.5,now())`,
      [MODELS[0], daysAgo(10)],
    );
    const r = await quotaReport(db, settings({ aiCreditUsd: 5, aiCreditAsOf: todayIct() }), { metaConfigured: true });
    expect(r.credit.spentSinceUsd).toBeCloseTo(1.5, 4);
    expect(r.credit.remainingUsd).toBeCloseTo(3.5, 4);
    expect(r.credit.view.state).toBe('con');
  });

  it('credit chưa nhập số dư: báo chưa rõ, không chặn tạo bài', async () => {
    const r = await quotaReport(db, settings(), { metaConfigured: true });
    expect(r.credit.view.state).toBe('chua-ro');
    expect(r.verdict.canGenerate).toBe(true);
  });

  it('Meta: chỉ đếm bài hẹn qua API trong 24 giờ', async () => {
    const id = await svc.createGenerated(db, pkg('https://vnexpress.net/q1'), 'test');
    await db.query(
      `INSERT INTO approval_event (content_id, revision, package_hash, actor, action, created_at) VALUES
       ($1,1,'h','system','PUBLISH',now()), ($1,1,'h','system','PUBLISH',now()), ($1,1,'h','system','PUBLISH',$2)`,
      [id, daysAgo(3)],
    );
    const r = await quotaReport(db, settings(), { metaConfigured: true });
    expect(r.meta.posts24h).toBe(2);
    expect(r.meta.postView.state).toBe('con');
    expect(r.verdict.canPost).toBe(true);
  });

  it('Meta đang tạm dừng do lượt gọi (BUC): không cho hẹn bài', async () => {
    await setFlag(db, BUC_UNTIL_KEY, String(Date.now() + 3_600_000), 'system:buc');
    const r = await quotaReport(db, settings(), { metaConfigured: true });
    expect(r.meta.bucPausedUntil).not.toBeNull();
    expect(r.verdict.canPost).toBe(false);
    expect(r.verdict.postReason).toContain('tạm giới hạn');
  });

  it('chưa cấu hình Trang Meta: không cho hẹn bài', async () => {
    const r = await quotaReport(db, settings(), { metaConfigured: false });
    expect(r.verdict.canPost).toBe(false);
    expect(r.verdict.postReason).toContain('Chưa cấu hình');
  });

  it('cờ hết hạn mức quá hạn (từ ngày hôm trước) không còn tính là hết hôm nay', async () => {
    await setFlag(db, AI_HIT_PREFIX + MODELS[0]!, daysAgo(2).toISOString(), 'system:ai');
    const r = await quotaReport(db, settings(), { metaConfigured: true });
    expect(r.models.find((m) => m.model === MODELS[0])!.hitToday).toBe(false);
  });
});
