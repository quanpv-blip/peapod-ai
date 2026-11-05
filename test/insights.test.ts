import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { bestSlot, engagement, localHour, summarize, type PostMetric } from '../src/domain/insights.ts';
import { fetchPostMetric, listMetrics, metricOf, refreshMetrics } from '../src/services/metrics.ts';
import type { MetaClient } from '../src/providers/meta.ts';
import type { Actor } from '../src/auth.ts';
import { createGenerated } from '../src/services/contents.ts';
import type { ContentPackage } from '../src/domain/package.ts';
import { freshDb } from './helpers/freshDb.ts';

const pm = (over: Partial<PostMetric> = {}): PostMetric => ({ id: 1, market: 'VN', headline: 'h', postedAt: new Date('2026-11-03T04:30:00Z'), reactions: 10, comments: 2, shares: 1, impressions: 500, ...over });

describe('phân tích tương tác', () => {
  it('điểm tương tác: thích + 3 × bình luận + 5 × chia sẻ', () => {
    expect(engagement({ reactions: 10, comments: 2, shares: 1 })).toBe(21);
  });

  it('giờ địa phương theo thị trường', () => {
    expect(localHour('VN', new Date('2026-11-03T04:30:00Z'))).toBe(11);
    expect(localHour('JP', new Date('2026-11-03T03:00:00Z'))).toBe(12);
  });

  it('khung giờ tốt nhất: chỉ tính khung đủ bài, chọn trung bình cao nhất', () => {
    const at = (h: number) => new Date(Date.UTC(2026, 10, 3, h - 7, 0));
    const data = [pm({ postedAt: at(11), reactions: 10 }), pm({ postedAt: at(11), reactions: 30 }), pm({ postedAt: at(16), reactions: 100 }), pm({ postedAt: at(9), reactions: 5 }), pm({ postedAt: at(9), reactions: 7 })];
    const b = bestSlot(data, 'VN')!;
    expect(b.hour).toBe(11); // 16h chỉ có 1 bài nên bị bỏ dù cao nhất
    expect(b.posts).toBe(2);
  });

  it('chưa đủ dữ liệu thì không kết luận; thị trường khác không lẫn vào', () => {
    expect(bestSlot([pm()], 'VN')).toBeNull();
    expect(bestSlot([pm({ market: 'JP' }), pm({ market: 'JP' })], 'VN')).toBeNull();
  });

  it('tổng hợp: cộng dồn, hiển thị null khi chưa có số liệu hiển thị, bài nổi bật xếp giảm dần', () => {
    const s = summarize([pm({ id: 1, reactions: 1, impressions: null }), pm({ id: 2, reactions: 50, impressions: null })]);
    expect(s.posts).toBe(2);
    expect(s.impressions).toBeNull();
    expect(s.top[0]!.id).toBe(2);
    expect(summarize([]).avgEngagement).toBeNull();
  });
});

describe('đọc số liệu từ Meta (Meta giả)', () => {
  const meta = (impressionsFail = false) => ({
    get: vi.fn(async (_t: string, path: string) => {
      if (path.endsWith('/insights')) {
        if (impressionsFail) throw new Error('(#10) thiếu quyền');
        return { status: 200, json: { data: [{ values: [{ value: 1234 }] }] }, headers: new Headers() };
      }
      return { status: 200, json: { reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } }, headers: new Headers() };
    }),
  }) as unknown as MetaClient & { get: ReturnType<typeof vi.fn> };

  it('đọc đủ phản ứng, bình luận, chia sẻ, lượt hiển thị', async () => {
    expect(await fetchPostMetric(meta(), 'T', 'P_1')).toEqual({ reactions: 7, comments: 2, shares: 1, impressions: 1234 });
  });

  it('bài ảnh: Meta từ chối trường shares (lỗi thật đã gặp) thì vẫn đọc được phản ứng và bình luận', async () => {
    const m = { get: vi.fn(async (_t: string, path: string, q?: Record<string, string>) => {
      if (q?.fields === 'shares') throw new Error('(#100) Tried accessing nonexisting field (shares)');
      if (path.endsWith('/insights')) throw new Error('(#10) thiếu quyền');
      return { status: 200, json: { reactions: { summary: { total_count: 3 } }, comments: { summary: { total_count: 0 } } }, headers: new Headers() };
    }) } as unknown as MetaClient;
    expect(await fetchPostMetric(m, 'T', 'PHOTO_1')).toEqual({ reactions: 3, comments: 0, shares: 0, impressions: null });
  });

  it('bài ảnh không có "reactions" (lỗi thật đã gặp): dùng "likes" thay thế', async () => {
    const m = { get: vi.fn(async (_t: string, path: string, q?: Record<string, string>) => {
      if (q?.fields?.startsWith('reactions')) throw new Error('(#100) Tried accessing nonexisting field (reactions)');
      if (q?.fields === 'shares' || path.endsWith('/insights')) throw new Error('không có');
      return { status: 200, json: { likes: { summary: { total_count: 9 } }, comments: { summary: { total_count: 2 } } }, headers: new Headers() };
    }) } as unknown as MetaClient;
    expect(await fetchPostMetric(m, 'T', 'PHOTO_2')).toEqual({ reactions: 9, comments: 2, shares: 0, impressions: null });
  });

  it('thiếu quyền read_insights: vẫn có số cơ bản, lượt hiển thị là null', async () => {
    expect(await fetchPostMetric(meta(true), 'T', 'P_1')).toEqual({ reactions: 7, comments: 2, shares: 1, impressions: null });
  });
});

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql', '007_source_items.sql', '008_perf_indexes.sql', '009_post_metric.sql'];
const admin: Actor = { email: 'ad@t', name: 'A', roles: ['admin'] };
const pkg: ContentPackage = { market: 'VN', topic_summary: 't', post: { headline: 'Tin đã đăng', body: 'x', call_to_action: 'y', hashtags: [] }, sources: [], claims_to_verify: [], media: { engine: 'NONE' } };

d('lưu và làm mới số liệu (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
  const now = new Date('2026-11-05T10:00:00Z');
  beforeAll(async () => { const f = await freshDb(URL_!, MIGRATIONS); db = f.db; drop = f.drop; });
  afterAll(async () => { await drop?.(); });

  async function published(daysAgo: number, fb = `PG_${daysAgo}`): Promise<number> {
    const id = await createGenerated(db, pkg, 't');
    await db.query("UPDATE content_item SET state = 'PUBLISHED', fb_post_id = $2, scheduled_at = $3 WHERE id = $1", [id, fb, new Date(now.getTime() - daysAgo * 86_400_000)]);
    return id;
  }
  const meta = () => ({
    get: vi.fn(async (_t: string, path: string) => path.endsWith('/insights')
      ? { status: 200, json: { data: [{ values: [{ value: 900 }] }] }, headers: new Headers() }
      : { status: 200, json: { reactions: { summary: { total_count: 4 } }, comments: { summary: { total_count: 1 } }, shares: { count: 0 } }, headers: new Headers() }),
  }) as unknown as MetaClient & { get: ReturnType<typeof vi.fn> };

  it('ghi số liệu cho bài đã đăng, bỏ bài quá 30 ngày; đọc lại qua listMetrics/metricOf', async () => {
    const a = await published(1);
    await published(40);
    const m = meta();
    const r = await refreshMetrics({ db, meta: m, pages: { VN: { id: 'PG', token: 'T' } }, now: () => now });
    expect(r).toEqual({ updated: 1, failed: 0 });
    expect(await metricOf(db, a)).toMatchObject({ reactions: 4, comments: 1, impressions: 900 });
    const list = await listMetrics(db, admin, 30, now);
    expect(list.map((x) => x.id)).toEqual([a]);
  });

  it('không đọc lại bài vừa cập nhật (chống gọi Meta thừa); sau 2 giờ thì đọc lại', async () => {
    const m = meta();
    const deps = { db, meta: m, pages: { VN: { id: 'PG', token: 'T' } } };
    expect((await refreshMetrics({ ...deps, now: () => new Date(now.getTime() + 30 * 60_000) })).updated).toBe(0);
    expect((await refreshMetrics({ ...deps, now: () => new Date(now.getTime() + 3 * 3_600_000) })).updated).toBe(1);
  });

  it('một bài lỗi không làm hỏng cả lượt', async () => {
    await published(2, 'BAD');
    const m = { get: vi.fn(async (_t: string, path: string) => { if (path.startsWith('BAD')) throw new Error('lỗi mạng'); return { status: 200, json: {}, headers: new Headers() }; }) } as unknown as MetaClient;
    const r = await refreshMetrics({ db, meta: m, pages: { VN: { id: 'PG', token: 'T' } }, now: () => new Date(now.getTime() + 6 * 3_600_000) });
    expect(r.failed).toBe(1);
    expect(r.updated).toBeGreaterThanOrEqual(1);
  });
});
