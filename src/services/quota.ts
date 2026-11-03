// Tổng hợp hạn mức AI, credit và giới hạn đăng Meta cho trang "Hạn mức & credit".
import type pg from 'pg';
import { dailyLimitState, creditRemaining, metaPostState, nextPacificMidnight, type LimitView } from '../domain/quota.ts';
import type { AppSettings } from '../domain/appSettings.ts';
import { modelChainFromEnv } from '../providers/aiChain.ts';
import { getFlag, setFlag } from './appSettings.ts';
import { BUC_UNTIL_KEY, META_USAGE_KEY } from './publish.ts';

export const AI_HIT_PREFIX = 'ai_hit:';

/**
 * Ghi nhận một lần mô hình báo hết hạn mức (dùng cho chuỗi dự phòng).
 * Trả về true nếu đây là lần đầu trong chu kỳ hạn mức hôm nay (để chỉ cảnh báo một lần mỗi ngày).
 */
export async function markAiExhausted(db: pg.Pool, model: string, now = new Date()): Promise<boolean> {
  const prev = await getFlag(db, AI_HIT_PREFIX + model);
  const firstToday = !prev || new Date(prev).getTime() < pacificDayStart(now).getTime();
  await setFlag(db, AI_HIT_PREFIX + model, now.toISOString(), 'system:ai');
  return firstToday;
}

/** Mốc bắt đầu chu kỳ hạn mức Gemini hiện tại: nửa đêm giờ Thái Bình Dương gần nhất. */
export function pacificDayStart(now: Date): Date {
  // Lùi từ lần reset kế tiếp: reset kế tiếp trừ một ngày (sai số tối đa một giờ khi đổi giờ mùa hè).
  return new Date(nextPacificMidnight(now).getTime() - 24 * 3_600_000);
}

export interface AiModelRow {
  model: string;
  calls: number;
  limit: number;
  view: LimitView;
  hitToday: boolean;
  resetAt: Date;
}

export interface QuotaReport {
  models: AiModelRow[];
  credit: { balanceUsd: number; asOf: string; spentSinceUsd: number; remainingUsd: number; view: LimitView };
  meta: { configured: boolean; posts24h: number; postView: LimitView; bucPct: number | null; bucCheckedAt: string | null; bucPausedUntil: Date | null };
  verdict: { canGenerate: boolean; generateReason: string; canPost: boolean; postReason: string };
}

export async function quotaReport(db: pg.Pool, s: AppSettings, opts: { metaConfigured: boolean; now?: Date }): Promise<QuotaReport> {
  const now = opts.now ?? new Date();
  const windowStart = pacificDayStart(now);
  const models = modelChainFromEnv();

  const counts = await db.query<{ model: string; n: number }>('SELECT model, count(*)::int AS n FROM ai_usage WHERE created_at >= $1 GROUP BY model', [windowStart]);
  const byModel = new Map(counts.rows.map((r) => [r.model, r.n]));

  const modelRows: AiModelRow[] = [];
  for (const model of models) {
    const calls = byModel.get(model) ?? 0;
    const hitAt = await getFlag(db, AI_HIT_PREFIX + model);
    const hitToday = !!hitAt && new Date(hitAt).getTime() >= windowStart.getTime();
    modelRows.push({ model, calls, limit: s.aiRequestLimit, hitToday, view: dailyLimitState(calls, s.aiRequestLimit, hitToday), resetAt: nextPacificMidnight(now) });
  }

  // Credit: số dư nhập tay trừ chi phí ghi nhận từ ngày nhập.
  const asOfDate = s.aiCreditAsOf ? new Date(`${s.aiCreditAsOf}T00:00:00+07:00`) : null;
  const spent = asOfDate
    ? Number((await db.query<{ s: string }>('SELECT COALESCE(SUM(cost_usd),0)::text AS s FROM ai_usage WHERE created_at >= $1', [asOfDate])).rows[0]!.s)
    : 0;
  const credit = creditRemaining(s.aiCreditUsd, spent);

  // Meta: số bài đã hẹn qua API trong 24 giờ, lượt gọi gần nhất, và trạng thái tạm dừng BUC.
  const posts24h = Number((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM approval_event WHERE action = 'PUBLISH' AND created_at >= $1", [new Date(now.getTime() - 24 * 3_600_000)])).rows[0]!.n);
  const postView = metaPostState(posts24h);
  const usageRaw = await getFlag(db, META_USAGE_KEY);
  const usage = usageRaw ? (JSON.parse(usageRaw) as { pct: number; at: string }) : null;
  const bucUntil = Number((await getFlag(db, BUC_UNTIL_KEY)) ?? 0);
  const bucPausedUntil = bucUntil > now.getTime() ? new Date(bucUntil) : null;

  const anyModelOk = modelRows.some((m) => m.view.state !== 'het');
  const creditBlocks = s.aiCreditUsd > 0 && credit.state === 'het';
  const canGenerate = anyModelOk && !creditBlocks;
  const generateReason = !anyModelOk
    ? `Tất cả mô hình đã hết hạn mức hôm nay. Reset lúc ${nextPacificMidnight(now).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} giờ Việt Nam.`
    : creditBlocks
      ? 'Credit đã hết theo ước tính. Nạp thêm trước khi tạo bài.'
      : 'Còn hạn mức AI để tạo bài.';

  const canPost = opts.metaConfigured && !bucPausedUntil && postView.state !== 'het';
  const postReason = !opts.metaConfigured
    ? 'Chưa cấu hình Trang Meta (token, Page ID).'
    : bucPausedUntil
      ? `Meta đang tạm giới hạn lượt gọi đến ${bucPausedUntil.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.`
      : postView.state === 'het'
        ? `Đã đạt giới hạn ${posts24h} bài trong 24 giờ.`
        : 'Còn có thể hẹn bài lên Trang.';

  return {
    models: modelRows,
    credit: { balanceUsd: s.aiCreditUsd, asOf: s.aiCreditAsOf, spentSinceUsd: spent, remainingUsd: credit.remainingUsd, view: { state: credit.state, label: credit.label, pct: null } },
    meta: { configured: opts.metaConfigured, posts24h, postView, bucPct: usage?.pct ?? null, bucCheckedAt: usage?.at ?? null, bucPausedUntil },
    verdict: { canGenerate, generateReason, canPost, postReason },
  };
}
