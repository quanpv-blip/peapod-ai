// Chi phí AI: ghi nhận từng lượt gọi, kiểm tra trần ngày/tháng, tổng hợp cho trang Chi phí.
import type pg from 'pg';
import type { AppSettings } from '../domain/appSettings.ts';
import type { Market } from '../domain/package.ts';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
}

/** Chi phí ước tính của một lượt (USD). Suy luận được tính như token ra. */
export function estimateCost(u: Usage, s: Pick<AppSettings, 'priceInPerM' | 'priceOutPerM'>): number {
  return (u.inputTokens * s.priceInPerM + (u.outputTokens + u.thoughtTokens) * s.priceOutPerM) / 1_000_000;
}

export async function recordUsage(db: pg.Pool, a: { market: Market; purpose: 'NEWS' | 'CAMPAIGN'; model: string; usage: Usage; costUsd: number }): Promise<void> {
  await db.query(
    'INSERT INTO ai_usage(market, purpose, model, tokens_in, tokens_out, tokens_think, cost_usd) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [a.market, a.purpose, a.model, a.usage.inputTokens, a.usage.outputTokens, a.usage.thoughtTokens, a.costUsd],
  );
}

/** Ngày đầu tháng và ngày đầu ngày theo giờ Việt Nam (đơn vị chi phí dùng múi giờ ICT). */
export function ictStart(now: Date): { day: Date; month: Date } {
  const ict = new Date(now.getTime() + 7 * 3_600_000);
  const day = new Date(Date.UTC(ict.getUTCFullYear(), ict.getUTCMonth(), ict.getUTCDate()) - 7 * 3_600_000);
  const month = new Date(Date.UTC(ict.getUTCFullYear(), ict.getUTCMonth(), 1) - 7 * 3_600_000);
  return { day, month };
}

export async function spendSince(db: pg.Pool | pg.PoolClient, since: Date): Promise<number> {
  const r = await db.query<{ s: string }>('SELECT COALESCE(SUM(cost_usd), 0)::text AS s FROM ai_usage WHERE created_at >= $1', [since]);
  return Number(r.rows[0]!.s);
}

/** Có được gọi AI thêm không? Trần 0 nghĩa là không giới hạn. */
export async function capCheck(db: pg.Pool, s: AppSettings, now = new Date()): Promise<{ allowed: boolean; reason?: string; todayUsd: number; monthUsd: number }> {
  const { day, month } = ictStart(now);
  const todayUsd = await spendSince(db, day);
  const monthUsd = await spendSince(db, month);
  if (s.dailyCapUsd > 0 && todayUsd >= s.dailyCapUsd) return { allowed: false, reason: `Đã đạt trần ngày (${s.dailyCapUsd} USD)`, todayUsd, monthUsd };
  if (s.monthlyCapUsd > 0 && monthUsd >= s.monthlyCapUsd) return { allowed: false, reason: `Đã đạt trần tháng (${s.monthlyCapUsd} USD)`, todayUsd, monthUsd };
  return { allowed: true, todayUsd, monthUsd };
}

export interface CostSummary {
  todayUsd: number;
  monthUsd: number;
  byModel: { model: string; calls: number; tokensIn: number; tokensOut: number; costUsd: number }[];
  byDay: { day: string; costUsd: number; calls: number }[];
  recent: { created_at: Date; market: Market; purpose: string; model: string; tokens_in: number; tokens_out: number; cost_usd: number }[];
}

export async function costSummary(db: pg.Pool, now = new Date()): Promise<CostSummary> {
  const { day, month } = ictStart(now);
  const since30 = new Date(now.getTime() - 30 * 86_400_000);
  const [todayUsd, monthUsd, byModel, byDay, recent] = await Promise.all([
    spendSince(db, day),
    spendSince(db, month),
    db.query<{ model: string; calls: string; ti: string; to_: string; c: string }>(
      `SELECT model, count(*)::text AS calls, COALESCE(SUM(tokens_in),0)::text AS ti, COALESCE(SUM(tokens_out),0)::text AS to_, COALESCE(SUM(cost_usd),0)::text AS c
         FROM ai_usage WHERE created_at >= $1 GROUP BY model ORDER BY SUM(cost_usd) DESC`, [month]),
    db.query<{ day: string; c: string; calls: string }>(
      `SELECT to_char((created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS day, COALESCE(SUM(cost_usd),0)::text AS c, count(*)::text AS calls
         FROM ai_usage WHERE created_at >= $1 GROUP BY 1 ORDER BY 1 DESC`, [since30]),
    db.query<{ created_at: Date; market: Market; purpose: string; model: string; tokens_in: number; tokens_out: number; cost_usd: string }>(
      'SELECT created_at, market, purpose, model, tokens_in, tokens_out, cost_usd FROM ai_usage ORDER BY id DESC LIMIT 20'),
  ]);
  return {
    todayUsd,
    monthUsd,
    byModel: byModel.rows.map((r) => ({ model: r.model, calls: Number(r.calls), tokensIn: Number(r.ti), tokensOut: Number(r.to_), costUsd: Number(r.c) })),
    byDay: byDay.rows.map((r) => ({ day: r.day, costUsd: Number(r.c), calls: Number(r.calls) })),
    recent: recent.rows.map((r) => ({ ...r, cost_usd: Number(r.cost_usd) })),
  };
}
