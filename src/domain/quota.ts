// Logic thuần cho hạn mức, credit và giới hạn đăng. Không I/O.
// Lưu ý: Gemini không cung cấp API đọc hạn mức còn lại; các con số ở đây là ước tính từ chính ứng dụng ghi lại.

export type LimitState = 'con' | 'sap-het' | 'het' | 'chua-ro';

export interface LimitView {
  state: LimitState;
  label: string;
  /** Tỷ lệ đã dùng (0–100), null nếu không rõ. */
  pct: number | null;
}

/**
 * Trạng thái một hạn mức theo ngày.
 * - `hitToday`: đã có lần nào nhận lỗi hết hạn mức (429) trong ngày, thì coi như hết bất kể đếm.
 * - `limit` 0 hoặc âm: không rõ giới hạn -> chưa rõ.
 */
export function dailyLimitState(used: number, limit: number, hitToday: boolean): LimitView {
  if (hitToday) return { state: 'het', label: 'Đã hết hạn mức trong ngày', pct: 100 };
  if (!(limit > 0)) return { state: 'chua-ro', label: 'Chưa cấu hình giới hạn', pct: null };
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const remaining = Math.max(0, limit - used);
  if (remaining === 0) return { state: 'het', label: 'Đã dùng hết hạn mức', pct: 100 };
  if (pct >= 80) return { state: 'sap-het', label: `Sắp hết: còn ${remaining}/${limit}`, pct };
  return { state: 'con', label: `Còn ${remaining}/${limit}`, pct };
}

/** Số dư credit còn lại = số dư nhập tay trừ đi chi phí ghi nhận từ thời điểm nhập. */
export function creditRemaining(balanceUsd: number, spentSinceUsd: number): { remainingUsd: number; state: LimitState; label: string } {
  if (!(balanceUsd > 0)) return { remainingUsd: 0, state: 'chua-ro', label: 'Chưa nhập số dư credit' };
  const remainingUsd = Math.max(0, balanceUsd - spentSinceUsd);
  if (remainingUsd === 0) return { remainingUsd, state: 'het', label: 'Đã hết credit (theo ước tính)' };
  if (remainingUsd < balanceUsd * 0.2) return { remainingUsd, state: 'sap-het', label: `Sắp hết: còn ${remainingUsd.toFixed(3)} USD` };
  return { remainingUsd, state: 'con', label: `Còn ${remainingUsd.toFixed(3)} USD` };
}

/** Giới hạn bài đăng qua API của Meta trong 24 giờ (docs/04: 30 bài/24h). */
export const META_POST_LIMIT_24H = 30;

export function metaPostState(posts24h: number, limit = META_POST_LIMIT_24H): LimitView {
  const remaining = Math.max(0, limit - posts24h);
  const pct = Math.min(100, Math.round((posts24h / limit) * 100));
  if (remaining === 0) return { state: 'het', label: `Đã đạt ${limit}/${limit} bài trong 24 giờ`, pct: 100 };
  if (pct >= 80) return { state: 'sap-het', label: `Sắp chạm giới hạn: ${posts24h}/${limit}`, pct };
  return { state: 'con', label: `${posts24h}/${limit} bài trong 24 giờ`, pct };
}

/**
 * Thời điểm hạn mức Gemini miễn phí được đặt lại: nửa đêm giờ Thái Bình Dương (theo chính sách Google, cần xác minh trên AI Studio).
 * Trả về mốc UTC của lần reset kế tiếp sau `now`.
 */
export function nextPacificMidnight(now: Date): Date {
  const pt = partsIn(now, 'America/Los_Angeles');
  const next = new Date(Date.UTC(pt.y, pt.m - 1, pt.d + 1));
  return ptWallToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0);
}

function partsIn(instant: Date, tz: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  return { y: +p.year!, m: +p.month!, d: +p.day!, h: +p.hour!, mi: +p.minute!, s: +p.second! };
}

/** Đổi giờ treo tường ở múi giờ Thái Bình Dương sang mốc UTC (xử lý giờ mùa hè). */
function ptWallToUtc(y: number, m: number, d: number, h: number): Date {
  const tz = 'America/Los_Angeles';
  const guess = Date.UTC(y, m - 1, d, h);
  const offsetAt = (t: number) => {
    const p = partsIn(new Date(t), tz);
    return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - t;
  };
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc);
  return new Date(utc);
}
