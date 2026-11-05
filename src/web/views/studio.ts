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
      <div class="page-head">
        <div><h1>Biên tập video</h1><div class="sub">Remotion Studio: xem trước, timeline, chỉnh tham số, xuất video mẫu.</div></div>
        ${v.studioUrl ? html`<a class="btn" href="${v.studioUrl}" target="_blank" rel="noopener">Mở ở tab mới</a>` : empty}
      </div>
      ${v.studioUrl
        ? html`<div class="studio-wrap">
              <iframe class="studio-frame" src="${v.studioUrl}" title="Remotion Studio" loading="eager" referrerpolicy="same-origin"></iframe>
            </div>
            <p class="studio-foot small muted">Khung trống hoặc báo lỗi kết nối: bấm "Mở ở tab mới". Máy đang mở PeaPod phải truy cập được ${v.studioUrl}. Studio chạy trên máy render bằng <code>npm run studio</code> trong peapod-video.</p>`
        : html`<div class="notice err" role="status">Chưa cấu hình REMOTION_STUDIO_URL trong .env (ví dụ http://192.168.1.145:3100). Xem README của peapod-video.</div>`}
    </div>`,
  );
}
