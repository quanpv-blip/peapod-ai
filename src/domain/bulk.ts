// Duyệt hàng loạt: chia giờ đăng cho nhiều bài của cùng một thị trường, mỗi bài một ngày làm việc, không trùng giờ đã có.
import type { Market } from './package.ts';
import { checkScheduleWindow, nextBusinessSlot } from './schedule.ts';

/** Trả về `count` giờ đăng (UTC) liên tiếp theo ngày làm việc, bỏ các giờ đã có bài (`taken`, mili giây). Có thể ít hơn `count` nếu vượt hạn 29 ngày. */
export function planSlots(market: Market, hhmm: string, count: number, taken: Iterable<number>, now: Date = new Date()): Date[] {
  const used = new Set(taken);
  const out: Date[] = [];
  let from = now;
  for (let guard = 0; guard < 80 && out.length < count; guard++) {
    const slot = nextBusinessSlot(market, hhmm, from);
    from = slot; // lần sau tìm giờ kế tiếp sau slot này
    if (!checkScheduleWindow(slot, now).ok) {
      if (slot.getTime() - now.getTime() > 20 * 86_400_000) break;
      continue;
    }
    if (used.has(slot.getTime())) continue;
    out.push(slot);
  }
  return out;
}
