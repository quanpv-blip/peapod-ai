// Các khối giao diện dùng chung cho video Reels: thanh tiến độ, nút dựng, khung lỗi.
// Thanh tiến độ dùng thẻ <progress> nên không cần style nội tuyến (CSP chặn style nội tuyến).
import { reelEtaText, reelPct, reelStageText, type ReelStatus } from '../../domain/reel.ts';
import { empty, html, type Safe } from '../html.ts';

/**
 * Thanh tiến độ đang dựng. `poll` bật tự cập nhật tại chỗ (xem /assets/reel.js): hỏi tiến độ ngầm, chỉ tải lại trang
 * MỘT lần khi dựng xong. `compact` dùng trong bảng trang Video (vẫn tự cập nhật nếu kèm poll).
 */
export function reelProgress(contentId: number, st: ReelStatus, csrf: string, opts: { compact?: boolean; poll?: boolean } = {}): Safe {
  const pct = reelPct(st);
  const inner = html`<progress class="reel-bar" data-reel-bar max="100" value="${pct}" aria-label="Tiến độ dựng video"></progress>
    <div class="reel-meta"><b data-reel-pct>${pct}%</b><span data-reel-stage>${reelStageText(st)}</span><span data-reel-eta>${reelEtaText(st)}</span></div>
    <div class="reel-row">
      <form method="post" action="/contents/${contentId}/reel/cancel" data-reel-cancel>
        <input type="hidden" name="_csrf" value="${csrf}">
        <button class="btn" type="submit">Hủy dựng</button>
      </form>
      <span class="small muted" data-reel-msg></span>
    </div>`;
  if (opts.poll) {
    return html`<div class="reel-progress${opts.compact ? ' compact' : ''}" data-reel-poll="/contents/${contentId}/reel/status" aria-live="polite">${inner}</div>`;
  }
  return html`<div class="reel-progress${opts.compact ? ' compact' : ''}" aria-live="polite">${inner}</div>`;
}

/** Nút dựng. Gắn data-reel-form để giao diện khóa nút ngay khi bấm (chống bấm nhiều lần). */
export function buildForm(contentId: number, csrf: string, label: string, back?: 'video', pickTemplate = false): Safe {
  return html`<form method="post" action="/contents/${contentId}/reel" data-reel-form>
    <input type="hidden" name="_csrf" value="${csrf}">${back ? html`<input type="hidden" name="back" value="video">` : empty}
    ${pickTemplate ? html`<label class="small">Mẫu video <select name="template" aria-label="Mẫu video"><option value="">Tự chọn theo nội dung</option><option value="list">Danh sách ý</option><option value="focus">Mỗi ý một cảnh</option><option value="alert">Cảnh báo (tông đỏ)</option></select></label>` : empty}
    <button class="btn primary" type="submit">${label}</button>
  </form>`;
}

export function reelErrorBox(msg: string): Safe {
  return html`<div class="notice err" role="alert">Dựng video lỗi: ${msg}</div>`;
}

/** Ghi chú không phải lỗi, ví dụ video được dựng nhưng không có tiếng. */
export function reelNoteBox(msg: string): Safe {
  return html`<div class="notice warn" role="status">${msg}</div>`;
}
