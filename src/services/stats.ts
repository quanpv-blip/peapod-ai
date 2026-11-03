import type pg from 'pg';
import { visibleMarkets, type Actor } from '../auth.ts';
import type { Market } from '../domain/package.ts';

export interface Stats {
  byState: Record<string, number>;
  byMarket: Record<Market, Record<string, number>>;
  pending: { count: number; oldestWaitMs: number | null; avgWaitMs: number | null; overdue: number };
  /** Đếm thao tác theo ngày (7 ngày gần nhất, giờ ICT), cũ -> mới. */
  daily: { day: string; label: string; approve: number; other: number }[];
  /** Tỷ lệ duyệt trong 7 ngày: APPROVE / (APPROVE + REJECT + REQUEST_CHANGES). null nếu chưa có quyết định. */
  approvalRate: number | null;
  decisions7d: number;
  upcoming: { id: number; market: Market; scheduled_at: Date; headline: string; state: string }[];
}

export const OVERDUE_HOURS = 24;
const DAY = 86_400_000;
const ICT = 7 * 3_600_000;

const dayKey = (t: number) => new Date(t + ICT).toISOString().slice(0, 10);

export async function getStats(db: pg.Pool, actor: Actor, now = new Date()): Promise<Stats> {
  const markets = visibleMarkets(actor);
  const empty: Stats = { byState: {}, byMarket: { VN: {}, JP: {} }, pending: { count: 0, oldestWaitMs: null, avgWaitMs: null, overdue: 0 }, daily: [], approvalRate: null, decisions7d: 0, upcoming: [] };
  if (markets.length === 0) return empty;

  const [cnt, wait, act, up] = await Promise.all([
    db.query('SELECT market, state, count(*)::int AS n FROM content_item WHERE market = ANY($1) GROUP BY 1,2', [markets]),
    db.query("SELECT updated_at FROM content_item WHERE state = 'IN_REVIEW' AND market = ANY($1)", [markets]),
    db.query(
      `SELECT to_char((e.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS day, e.action, count(*)::int AS n
         FROM approval_event e JOIN content_item c ON c.id = e.content_id
        WHERE c.market = ANY($1) AND e.created_at > $2 GROUP BY 1,2`, [markets, new Date(now.getTime() - 8 * DAY)]),
    db.query(
      `SELECT i.id, i.market, i.scheduled_at, i.state, r.package->'post'->>'headline' AS headline
         FROM content_item i JOIN content_revision r ON r.content_id = i.id AND r.revision = i.current_revision
        WHERE i.market = ANY($1) AND i.state IN ('APPROVED','SCHEDULED') AND i.scheduled_at >= $2
        ORDER BY i.scheduled_at LIMIT 6`, [markets, now]),
  ]);

  const s = empty;
  for (const r of cnt.rows) {
    s.byState[r.state] = (s.byState[r.state] ?? 0) + r.n;
    s.byMarket[r.market as Market][r.state] = r.n;
  }

  const waits = wait.rows.map((r) => now.getTime() - new Date(r.updated_at).getTime());
  s.pending = {
    count: waits.length,
    oldestWaitMs: waits.length ? Math.max(...waits) : null,
    avgWaitMs: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : null,
    overdue: waits.filter((w) => w > OVERDUE_HOURS * 3_600_000).length,
  };

  const byDay = new Map<string, { approve: number; other: number }>();
  let ap = 0, dec = 0;
  const since = dayKey(now.getTime() - 6 * DAY);
  for (const r of act.rows) {
    if (r.day < since) continue;
    const d = byDay.get(r.day) ?? { approve: 0, other: 0 };
    if (r.action === 'APPROVE') d.approve += r.n; else d.other += r.n;
    byDay.set(r.day, d);
    if (r.action === 'APPROVE') { ap += r.n; dec += r.n; }
    if (r.action === 'REJECT' || r.action === 'REQUEST_CHANGES') dec += r.n;
  }
  for (let i = 6; i >= 0; i--) {
    const k = dayKey(now.getTime() - i * DAY);
    const v = byDay.get(k) ?? { approve: 0, other: 0 };
    s.daily.push({ day: k, label: `${k.slice(8, 10)}/${k.slice(5, 7)}`, ...v });
  }
  s.decisions7d = dec;
  s.approvalRate = dec ? ap / dec : null;
  s.upcoming = up.rows.map((r) => ({ id: Number(r.id), market: r.market, scheduled_at: r.scheduled_at, headline: r.headline, state: r.state }));
  return s;
}

export async function pendingCount(db: pg.Pool, actor: Actor): Promise<number> {
  const markets = visibleMarkets(actor);
  if (!markets.length) return 0;
  const r = await db.query("SELECT count(*)::int AS n FROM content_item WHERE state = 'IN_REVIEW' AND market = ANY($1)", [markets]);
  return r.rows[0].n;
}
