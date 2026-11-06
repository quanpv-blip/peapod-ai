import type { Market } from '../domain/package.ts';
import type { Page } from '../domain/paging.ts';
import { html, type Safe } from './html.ts';

export const STATE: Record<string, { text: string; tone: '' | 'ok' | 'warn' | 'bad' | 'info' }> = {
  GENERATING: { text: 'Đang sinh nội dung', tone: 'info' },
  MEDIA_PENDING: { text: 'Đang tạo media', tone: 'info' },
  IN_REVIEW: { text: 'Chờ duyệt', tone: 'warn' },
  CHANGES_REQUESTED: { text: 'Cần chỉnh sửa', tone: 'warn' },
  APPROVED: { text: 'Đã duyệt', tone: 'ok' },
  SCHEDULED: { text: 'Đã hẹn giờ', tone: 'ok' },
  PUBLISHING: { text: 'Đang đăng', tone: 'info' },
  PUBLISHED: { text: 'Đã đăng', tone: 'ok' },
  REJECTED: { text: 'Đã từ chối', tone: 'bad' },
  CANCELLED: { text: 'Đã hủy', tone: 'bad' },
  FAILED_GENERATE: { text: 'Lỗi khi sinh', tone: 'bad' },
  FAILED_MEDIA: { text: 'Lỗi tạo media', tone: 'bad' },
  FAILED_PUBLISH: { text: 'Lỗi khi đăng', tone: 'bad' },
};

export const ACTION: Record<string, string> = {
  APPROVE: 'Duyệt',
  REJECT: 'Từ chối',
  REQUEST_CHANGES: 'Yêu cầu chỉnh sửa',
  EDIT: 'Chỉnh sửa nội dung',
  CANCEL: 'Hủy',
  PUBLISH: 'Hẹn giờ lên Trang',
  PUBLISHED: 'Đã đăng lên Trang',
  PUBLISH_FAILED: 'Đăng lỗi',
};

/** Tên hiển thị của người thực hiện: tiến trình hệ thống (system:publisher...) hiện bằng tiếng Việt thay vì mã. */
export function actorLabel(actor: string): string {
  if (!actor.startsWith('system:')) return actor;
  const map: Record<string, string> = { publisher: 'Hệ thống (đăng bài)', cycle: 'Hệ thống (chu kỳ nền)', reel: 'Hệ thống (video)', zalo: 'Hệ thống (cảnh báo)', telegram: 'Hệ thống (Telegram)' };
  return map[actor.slice('system:'.length)] ?? 'Hệ thống';
}

export const FORMAT: Record<string, string> = { TEXT: 'Chỉ văn bản', IMAGE: 'Ảnh thẻ', REEL: 'Video ngắn (Reel)' };

export const status = (state: string): Safe => {
  const s = STATE[state] ?? { text: state, tone: '' as const };
  return html`<span class="status ${s.tone}">${s.text}</span>`;
};

export const marketTag = (m: Market): Safe => html`<span class="tag">${m}</span>`;

const ZONE: Record<Market, { tz: string; label: string }> = {
  VN: { tz: 'Asia/Ho_Chi_Minh', label: 'ICT' },
  JP: { tz: 'Asia/Tokyo', label: 'JST' },
};

/** Ngày giờ theo múi giờ của thị trường, kèm nhãn múi giờ để người duyệt không nhầm. */
export function when(d: Date | string | null | undefined, market: Market): string {
  if (!d) return '-';
  const z = ZONE[market];
  const s = new Intl.DateTimeFormat('vi-VN', { timeZone: z.tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
  return `${s} ${z.label}`;
}

export const zoneLabel = (m: Market) => ZONE[m].label;

/** Thanh phân trang dùng chung; ẩn khi chỉ có một trang. `href(n)` tạo đường dẫn tới trang n. */
export const pager = (p: Page, href: (n: number) => string): Safe => p.pages <= 1
  ? html``
  : html`<nav class="pager" aria-label="Phân trang">
      ${p.page > 1 ? html`<a class="btn" href="${href(p.page - 1)}">‹ Trước</a>` : html`<span class="btn" aria-disabled="true">‹ Trước</span>`}
      <span class="small muted">Trang ${p.page} / ${p.pages} · ${p.total} mục</span>
      ${p.page < p.pages ? html`<a class="btn" href="${href(p.page + 1)}">Sau ›</a>` : html`<span class="btn" aria-disabled="true">Sau ›</span>`}
    </nav>`;

/** Khoảng thời gian dạng ngắn: "12 phút", "5 giờ", "2 ngày". */
export function span(ms: number | null): string {
  if (ms === null) return '-';
  const m = Math.max(0, Math.round(ms / 60_000));
  if (m < 60) return `${m} phút`;
  if (m < 48 * 60) return `${Math.round(m / 60)} giờ`;
  return `${Math.round(m / 1440)} ngày`;
}
