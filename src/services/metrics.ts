// Đọc số liệu tương tác bài đã đăng từ Meta và lưu vào post_metric; truy vấn lại cho trang Tổng quan.
import type pg from 'pg';
import { visibleMarkets, type Actor } from '../auth.ts';
import type { Market } from '../domain/package.ts';
import type { PostMetric } from '../domain/insights.ts';
import type { MetaClient } from '../providers/meta.ts';

interface PagePair { id: string; token: string }

export interface MetricsDeps {
  db: pg.Pool;
  meta: MetaClient;
  pages: Partial<Record<Market, PagePair>>;
  now?: () => Date;
}

const DAY = 86_400_000;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Đọc số liệu một bài. Số phản ứng/bình luận/chia sẻ dùng quyền cơ bản; lượt hiển thị cần read_insights nên lỗi thì để null. */
export async function fetchPostMetric(meta: MetaClient, token: string, postId: string): Promise<Omit<PostMetric, 'id' | 'market' | 'headline' | 'postedAt'>> {
  // Bài ảnh (đăng kèm thẻ) có ID ảnh, không có trường "shares": đọc riêng để thiếu trường này không làm hỏng cả lượt.
  // Bài văn bản có "reactions"; bài ảnh (ID ảnh) chỉ có "likes". Thử "reactions" trước, không được thì dùng "likes".
  const summary = (name: string) => `${name}.summary(true).limit(0)`;
  let likes = 0;
  let comments = 0;
  try {
    const res = await meta.get(token, postId, { fields: `${summary('reactions')},${summary('comments')}` });
    const j = res.json as { reactions?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } };
    likes = num(j.reactions?.summary?.total_count);
    comments = num(j.comments?.summary?.total_count);
  } catch {
    const res = await meta.get(token, postId, { fields: `${summary('likes')},${summary('comments')}` });
    const j = res.json as { likes?: { summary?: { total_count?: number } }; comments?: { summary?: { total_count?: number } } };
    likes = num(j.likes?.summary?.total_count);
    comments = num(j.comments?.summary?.total_count);
  }
  let shares = 0;
  try {
    const sh = await meta.get(token, postId, { fields: 'shares' });
    shares = num((sh.json as { shares?: { count?: number } }).shares?.count);
  } catch {
    shares = 0;
  }
  let impressions: number | null = null;
  try {
    const ins = await meta.get(token, `${postId}/insights`, { metric: 'post_impressions' });
    const v = (ins.json as { data?: { values?: { value?: unknown }[] }[] }).data?.[0]?.values?.[0]?.value;
    if (typeof v === 'number') impressions = v;
  } catch {
    impressions = null;
  }
  return { reactions: likes, comments, shares, impressions };
}

/**
 * Làm mới số liệu các bài đã đăng trong 30 ngày. Bài dưới 2 ngày tuổi đọc lại sau 2 giờ, bài cũ hơn sau 24 giờ.
 * Một bài lỗi không làm hỏng cả lượt. Trả về số bài đã cập nhật và số lỗi.
 */
export async function refreshMetrics(deps: MetricsDeps): Promise<{ updated: number; failed: number }> {
  const now = deps.now?.() ?? new Date();
  const r = await deps.db.query<{ id: string; market: Market; fb_post_id: string }>(
    `SELECT i.id, i.market, i.fb_post_id
       FROM content_item i LEFT JOIN post_metric m ON m.content_id = i.id
      WHERE i.state = 'PUBLISHED' AND i.fb_post_id IS NOT NULL AND i.scheduled_at >= $1
        AND (m.fetched_at IS NULL OR m.fetched_at < CASE WHEN i.scheduled_at >= $2 THEN $3::timestamptz ELSE $4::timestamptz END)
      ORDER BY i.scheduled_at DESC LIMIT 40`,
    [new Date(now.getTime() - 30 * DAY), new Date(now.getTime() - 2 * DAY), new Date(now.getTime() - 2 * 3_600_000), new Date(now.getTime() - DAY)],
  );
  let updated = 0;
  let failed = 0;
  for (const row of r.rows) {
    const page = deps.pages[row.market];
    if (!page) continue;
    try {
      const m = await fetchPostMetric(deps.meta, page.token, row.fb_post_id);
      await deps.db.query(
        `INSERT INTO post_metric(content_id, reactions, comments, shares, impressions, fetched_at) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (content_id) DO UPDATE SET reactions = EXCLUDED.reactions, comments = EXCLUDED.comments, shares = EXCLUDED.shares, impressions = EXCLUDED.impressions, fetched_at = EXCLUDED.fetched_at`,
        [row.id, m.reactions, m.comments, m.shares, m.impressions, now],
      );
      updated++;
    } catch (e) {
      failed++;
      console.warn(`cảnh báo: chưa đọc được số liệu bài #${row.id}: ${(e as Error).message.slice(0, 120)}`);
    }
  }
  return { updated, failed };
}

/** Số liệu các bài đã đăng trong `days` ngày gần đây, trong phạm vi thị trường người xem được thấy. */
export async function listMetrics(db: pg.Pool, actor: Actor, days = 30, now = new Date()): Promise<PostMetric[]> {
  const markets = visibleMarkets(actor);
  if (!markets.length) return [];
  const r = await db.query(
    `SELECT i.id, i.market, i.scheduled_at, rv.package->'post'->>'headline' AS headline,
            m.reactions, m.comments, m.shares, m.impressions
       FROM post_metric m
       JOIN content_item i ON i.id = m.content_id
       JOIN content_revision rv ON rv.content_id = i.id AND rv.revision = i.current_revision
      WHERE i.market = ANY($1) AND i.state = 'PUBLISHED' AND i.scheduled_at >= $2
      ORDER BY i.scheduled_at DESC`,
    [markets, new Date(now.getTime() - days * DAY)],
  );
  return r.rows.map((x) => ({ id: Number(x.id), market: x.market as Market, headline: x.headline as string, postedAt: new Date(x.scheduled_at), reactions: x.reactions, comments: x.comments, shares: x.shares, impressions: x.impressions }));
}

export async function metricOf(db: pg.Pool, id: number): Promise<{ reactions: number; comments: number; shares: number; impressions: number | null; fetchedAt: Date } | null> {
  const r = await db.query('SELECT reactions, comments, shares, impressions, fetched_at FROM post_metric WHERE content_id = $1', [id]);
  const x = r.rows[0];
  return x ? { reactions: x.reactions, comments: x.comments, shares: x.shares, impressions: x.impressions, fetchedAt: x.fetched_at } : null;
}
