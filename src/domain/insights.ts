// Phân tích số liệu tương tác: điểm tương tác của bài và khung giờ đăng hiệu quả nhất. Thuần tính toán, không I/O.
import type { Market } from './package.ts';

export interface PostMetric {
  id: number;
  market: Market;
  headline: string;
  /** Giờ đăng thực tế (UTC). */
  postedAt: Date;
  reactions: number;
  comments: number;
  shares: number;
  impressions: number | null;
}

/** Điểm tương tác: bình luận và chia sẻ có giá trị hơn một lượt thích. */
export const engagement = (m: Pick<PostMetric, 'reactions' | 'comments' | 'shares'>): number => m.reactions + 3 * m.comments + 5 * m.shares;

const OFFSET_H: Record<Market, number> = { VN: 7, JP: 9 };
/** Giờ địa phương (0..23) của thị trường tại thời điểm đăng. */
export const localHour = (m: Market, at: Date): number => new Date(at.getTime() + OFFSET_H[m] * 3_600_000).getUTCHours();

export interface BestSlot {
  hour: number;
  avg: number;
  posts: number;
}

/** Số bài tối thiểu mỗi khung giờ để dám kết luận. */
export const MIN_POSTS_PER_SLOT = 2;

/**
 * Khung giờ có tương tác trung bình cao nhất của một thị trường, chỉ xét khung có đủ bài.
 * Trả null nếu chưa đủ dữ liệu: không đoán khi số bài ít.
 */
export function bestSlot(metrics: PostMetric[], market: Market): BestSlot | null {
  const by = new Map<number, number[]>();
  for (const m of metrics) {
    if (m.market !== market) continue;
    const h = localHour(market, m.postedAt);
    by.set(h, [...(by.get(h) ?? []), engagement(m)]);
  }
  let best: BestSlot | null = null;
  for (const [hour, xs] of by) {
    if (xs.length < MIN_POSTS_PER_SLOT) continue;
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
    if (!best || avg > best.avg) best = { hour, avg, posts: xs.length };
  }
  return best;
}

export interface Summary {
  posts: number;
  reactions: number;
  comments: number;
  shares: number;
  impressions: number | null;
  avgEngagement: number | null;
  top: PostMetric[];
}

export function summarize(metrics: PostMetric[], topN = 5): Summary {
  const withImp = metrics.filter((m) => m.impressions !== null);
  return {
    posts: metrics.length,
    reactions: metrics.reduce((a, m) => a + m.reactions, 0),
    comments: metrics.reduce((a, m) => a + m.comments, 0),
    shares: metrics.reduce((a, m) => a + m.shares, 0),
    impressions: withImp.length ? withImp.reduce((a, m) => a + (m.impressions ?? 0), 0) : null,
    avgEngagement: metrics.length ? metrics.reduce((a, m) => a + engagement(m), 0) / metrics.length : null,
    top: [...metrics].sort((a, b) => engagement(b) - engagement(a)).slice(0, topN),
  };
}
