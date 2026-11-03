// Logic thuần cho việc đăng (P-01): nội dung đưa lên Trang và cổng giờ đăng. Không I/O.
import type { ContentPackage } from './package.ts';
import { checkScheduleWindow } from './schedule.ts';

/** Nội dung bài trên Trang: tiêu đề, thân, lời kêu gọi, hashtag. Nguồn đi kèm dưới dạng liên kết (FR-PUB-01). */
export function feedPost(pkg: ContentPackage): { message: string; link: string } {
  const p = pkg.post;
  const message = [p.headline, p.body, p.call_to_action, p.hashtags.join(' ')].filter((s) => s.trim() !== '').join('\n\n');
  return { message, link: pkg.sources[0]!.url };
}

/** Meta yêu cầu hẹn giờ cách hiện tại > 10 phút; cổng của ta là 15 phút (xem schedule.ts). */
export function scheduleGate(at: Date, now: Date): { ok: true } | { ok: false; reason: string } {
  const w = checkScheduleWindow(at, now);
  if (w.ok) return { ok: true };
  return {
    ok: false,
    reason: w.reason === 'TOO_SOON' ? 'Giờ đăng quá gần (cần cách hiện tại ít nhất 15 phút). Cần hẹn lại trước khi đăng.' : 'Giờ đăng vượt quá 29 ngày. Cần hẹn lại.',
  };
}

/**
 * Phần trăm lượt gọi đã dùng theo header x-business-use-case-usage của Meta (cao nhất trong các chỉ số).
 * Trả về 0 nếu header thiếu hoặc không đọc được: không chặn đăng khi không biết.
 */
export function bucUsagePct(header: string | null): number {
  if (!header) return 0;
  try {
    const j = JSON.parse(header) as Record<string, { call_count?: number; total_cputime?: number; total_time?: number }[]>;
    let max = 0;
    for (const entries of Object.values(j)) {
      for (const e of entries) max = Math.max(max, e.call_count ?? 0, e.total_cputime ?? 0, e.total_time ?? 0);
    }
    return Math.round(max);
  } catch {
    return 0;
  }
}

/** Lỗi 4xx (trừ 408, 429) là lỗi xác định: Meta đã từ chối, không có bài nào được tạo. Còn lại là không rõ kết quả. */
export function isDefinitiveRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}
