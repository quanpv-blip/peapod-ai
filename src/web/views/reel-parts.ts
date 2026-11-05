// Các khối giao diện dùng chung cho video Reels: thanh tiến độ, nút dựng, khung lỗi.
// Thanh tiến độ dùng thẻ <progress> nên không cần style nội tuyến (CSP chặn style nội tuyến).
import { reelEtaText, reelPct, reelStageText, type ReelStatus } from '../../domain/reel.ts';
import { empty, html, type Safe } from '../html.ts';

/**
 * Thanh tiến độ đang dựng. `poll` bật tự cập nhật trên trang bài (xem /assets/reel.js).
 * `compact` dùng trong bảng, không tự cập nhật từng dòng (trang Video tự tải lại theo nhịp).
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
    return html`<div class="reel-progress" data-reel-poll="/contents/${contentId}/reel/status" aria-live="polite">${inner}</div>`;
  }
  return html`<div class="reel-progress${opts.compact ? ' compact' : ''}" aria-live="polite">${inner}</div>`;
}

/** Nút dựng. Gắn data-reel-form để giao diện khóa nút ngay khi bấm (chống bấm nhiều lần). */
export function buildForm(contentId: number, csrf: string, label: string, back?: 'video'): Safe {
  return html`<form method="post" action="/contents/${contentId}/reel" data-reel-form>
    <input type="hidden" name="_csrf" value="${csrf}">${back ? html`<input type="hidden" name="back" value="video">` : empty}
    <button class="btn primary" type="submit">${label}</button>
  </form>`;
}

export function reelErrorBox(msg: string): Safe {
  return html`<div class="notice err" role="alert">Dựng video lỗi: ${msg}</div>`;
}
