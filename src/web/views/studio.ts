import { empty, html } from '../html.ts';
import { page, type PageCtx } from '../layout.ts';

export interface StudioView {
  ctx: Omit<PageCtx, 'title' | 'nav'>;
  /** Địa chỉ Remotion Studio mà trình duyệt truy cập được (REMOTION_STUDIO_URL). Thiếu thì không nhúng. */
  studioUrl: string | null;
}

export function studioView(v: StudioView): string {
  return page(
    { ...v.ctx, title: 'Biên tập video', nav: 'studio' },
    html`<div class="page studio-page">
      <div class="page-head"><div><h1>Biên tập video</h1><div class="sub">Giao diện Remotion Studio đầy đủ: xem trước, timeline, chỉnh tham số, xuất file. Dùng để chỉnh mẫu và thử thiết kế.</div></div>
        ${v.studioUrl ? html`<a class="btn" href="${v.studioUrl}" target="_blank" rel="noopener">Mở ở tab mới</a>` : empty}</div>
      ${v.studioUrl
        ? html`<iframe class="studio-frame" src="${v.studioUrl}" title="Remotion Studio" loading="eager" referrerpolicy="same-origin"></iframe>
            <p class="hint">Nếu khung trống: máy chạy Remotion chưa bật. Trên máy render, chạy <code>npm run studio</code> trong thư mục peapod-video.</p>`
        : html`<div class="notice err" role="status">Chưa cấu hình REMOTION_STUDIO_URL trong .env (ví dụ http://192.168.1.145:3000). Xem README của peapod-video.</div>`}
    </div>`,
  );
}
