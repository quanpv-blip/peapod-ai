// Kho tin RSS: lấy về, lưu, và tìm theo chủ đề. Chỉ dùng tiêu đề và đoạn tóm tắt của RSS (không tải toàn bộ bài báo).
import type pg from 'pg';
import type { FeedItem } from '../domain/rss.ts';
import type { Market } from '../domain/package.ts';

export interface SourceItem {
  id: number;
  market: Market;
  feed: string;
  url: string;
  title: string;
  summary: string;
  published_at: Date | null;
}

/** Lấy tin từ các nguồn RSS của thị trường và lưu (cập nhật nếu đã có URL). Trả về số tin đã ghi. */
export async function refreshSources(db: pg.Pool, market: Market, feeds: string[], fetchFeedsFn: (feeds: string[]) => Promise<FeedItem[]>): Promise<number> {
  const items = await fetchFeedsFn(feeds);
  let n = 0;
  for (const it of items.slice(0, 200)) {
    const feed = safeHost(it.url);
    await db.query(
      `INSERT INTO source_item(market, feed, url, title, summary, published_at, fetched_at) VALUES ($1,$2,$3,$4,$5,$6,now())
       ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, summary = EXCLUDED.summary, fetched_at = now()`,
      [market, feed, it.url, it.title.slice(0, 300), it.summary.slice(0, 2000), it.publishedAt ? new Date(it.publishedAt) : null],
    );
    n++;
  }
  return n;
}

const safeHost = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return 'unknown';
  }
};

/** Tin gần đây của thị trường, mới nhất trước. */
export async function recentItems(db: pg.Pool, market: Market, now = new Date(), days = 7, limit = 200): Promise<SourceItem[]> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const r = await db.query<SourceItem>(
    `SELECT id, market, feed, url, title, summary, published_at FROM source_item
      WHERE market = $1 AND COALESCE(published_at, fetched_at) >= $2
      ORDER BY COALESCE(published_at, fetched_at) DESC LIMIT $3`,
    [market, since, limit],
  );
  return r.rows;
}

const STOP = new Set(['và', 'của', 'các', 'cho', 'với', 'trong', 'là', 'có', 'được', 'một', 'những', 'the', 'and', 'for', 'về', 'theo', 'tại', 'khi', 'này', 'đã', 'sẽ', 'thế', 'giới', 'mới', 'năm', 'nhiều', 'người', 'công', 'việc', 'đang', 'hôm', 'nay', 'sau', 'trước', 'nói', 'cho', 'để', 'hay', 'hoặc', 'từ', 'bằng', 'đến', 'ra', 'lên']);

/** Tách từ khóa của chủ đề (bỏ từ nối, từ quá ngắn). Hỗ trợ chữ Nhật và Việt đơn giản bằng khoảng trắng và dấu câu. */
export function topicTerms(topic: string): string[] {
  return [...new Set(topic.toLowerCase().split(/[\s,.;:!?、。・「」『』()（）\[\]]+/u).filter((w) => w.length >= 2 && !STOP.has(w)))];
}

/** Chấm điểm tin theo số từ khóa xuất hiện trong tiêu đề (trọng số cao) và tóm tắt. Trả về các tin có điểm > 0, tốt nhất trước. */
export function scoreItems(items: SourceItem[], topic: string, limit = 3): SourceItem[] {
  const terms = topicTerms(topic);
  if (terms.length === 0) return [];
  // Cần khớp ít nhất một nửa số từ khóa (tối thiểu 1) để tránh tin chỉ trùng một từ chung.
  const need = Math.max(1, Math.ceil(terms.length / 2));
  return items
    .map((it) => {
      const t = it.title.toLowerCase();
      const s = it.summary.toLowerCase();
      const matched = terms.filter((w) => t.includes(w) || s.includes(w)).length;
      const score = terms.reduce((acc, w) => acc + (t.includes(w) ? 2 : 0) + (s.includes(w) ? 1 : 0), 0);
      return { it, score, matched };
    })
    .filter((x) => x.matched >= need)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.it);
}
