// FR-REV-06: giờ đăng. Meta yêu cầu scheduled_publish_time > 10 phút và < 29 ngày (docs/04 mục 3.3);
// ta đặt lề an toàn 15 phút. Việt Nam (ICT, UTC+7) và Nhật Bản (JST, UTC+9) không có giờ mùa hè nên dùng độ lệch cố định.

import type { Market } from './package.ts';

export const MIN_LEAD_MINUTES = 15;
export const MAX_LEAD_DAYS = 29;

const OFFSET_MINUTES: Record<Market, number> = { VN: 7 * 60, JP: 9 * 60 };
export const DEFAULT_LOCAL_TIME: Record<Market, string> = { VN: '11:30', JP: '12:00' };

/** Giá trị cho `<input type="datetime-local">` theo giờ địa phương của thị trường: "YYYY-MM-DDTHH:mm". */
export function toLocalInput(at: Date, market: Market): string {
  return new Date(at.getTime() + OFFSET_MINUTES[market] * 60_000).toISOString().slice(0, 16);
}

/** Ngược lại: chuỗi giờ địa phương của thị trường -> thời điểm UTC; null nếu sai định dạng. */
export function fromLocalInput(value: string, market: Market): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  const t = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(t);
  // Từ chối ngày không tồn tại (ví dụ 31/02) thay vì để JS tự cuộn sang tháng sau.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d || h > 23 || mi > 59) return null;
  return new Date(t - OFFSET_MINUTES[market] * 60_000);
}

export type ScheduleCheck = { ok: true } | { ok: false; reason: 'TOO_SOON' | 'TOO_FAR' };

export function checkScheduleWindow(at: Date, now: Date = new Date()): ScheduleCheck {
  const min = now.getTime() + MIN_LEAD_MINUTES * 60_000;
  // Trừ 1 giờ để không chạm sát giới hạn 29 ngày của Meta.
  const max = now.getTime() + MAX_LEAD_DAYS * 86_400_000 - 3_600_000;
  if (at.getTime() < min) return { ok: false, reason: 'TOO_SOON' };
  if (at.getTime() > max) return { ok: false, reason: 'TOO_FAR' };
  return { ok: true };
}

/** Thời điểm UTC kế tiếp mà đồng hồ địa phương của thị trường chỉ `hhmm`, cách `now` ít nhất MIN_LEAD_MINUTES. */
export function nextLocalSlot(market: Market, hhmm: string, now: Date = new Date()): Date {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new Error(`Giờ không hợp lệ: ${hhmm}`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) throw new Error(`Giờ không hợp lệ: ${hhmm}`);
  const off = OFFSET_MINUTES[market] * 60_000;
  const earliest = now.getTime() + MIN_LEAD_MINUTES * 60_000;

  // Ngày địa phương của `earliest`, rồi ghép giờ địa phương và đổi lại UTC.
  const local = new Date(earliest + off);
  let candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, min) - off;
  while (candidate < earliest) candidate += 86_400_000;
  return new Date(candidate);
}

/** Bỏ qua cuối tuần theo ngày địa phương của thị trường (BRD: nhịp theo ngày làm việc). */
export function nextBusinessSlot(market: Market, hhmm: string, now: Date = new Date()): Date {
  const off = OFFSET_MINUTES[market] * 60_000;
  let slot = nextLocalSlot(market, hhmm, now);
  for (let i = 0; i < 7; i++) {
    const dow = new Date(slot.getTime() + off).getUTCDay(); // 0 = CN, 6 = T7
    if (dow !== 0 && dow !== 6) return slot;
    slot = new Date(slot.getTime() + 86_400_000);
  }
  return slot;
}
