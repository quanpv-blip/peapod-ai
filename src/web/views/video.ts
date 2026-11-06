import type { ContentRow } from '../../services/contents.ts';
import type { ReelStatus } from '../../domain/reel.ts';
import type { Page } from '../../domain/paging.ts';
import { marketTag, pager, status } from '../components.ts';
import { empty, html, type Safe } from '../html.ts';
import { flashBox, page, type Flash, type PageCtx } from '../layout.ts';
import { buildForm, reelErrorBox, reelProgress } from './reel-parts.ts';

export interface VideoRowInfo {
  headline: string;
  /** Đã có video cho đúng bản hiện tại. */
  built: boolean;
  /** Có video nhưng của bản cũ (null nếu không có). */
  builtRevision: number | null;
  reel: ReelStatus | null;
}

export interface VideoView {
  ctx: Omit<PageCtx, 'title' | 'nav'>;
  rows: ContentRow[];
  info: Map<string, VideoRowInfo>;
  filter: { state: string; market: string };
  page: Page;
  markets: string[];
  /** Đã cấu hình dịch vụ Remotion (REMOTION_RENDER_URL). */
  reelOn: boolean;
  /** Người dùng có quyền dựng video cho thị trường này. */
  canBuild: (market: string) => boolean;
  flash?: Flash;
}

const STATE_FILTERS: [string, string][] = [
  ['', 'Tất cả'],
  ['IN_REVIEW', 'Chờ duyệt'],
  ['APPROVED', 'Đã duyệt'],
  ['SCHEDULED', 'Đã hẹn giờ'],
  ['PUBLISHED', 'Đã đăng'],
];

function link(state: string, market: string, n = 1): string {
  const p = new URLSearchParams();
  if (state) p.set('state', state);
  if (market) p.set('market', market);
  if (n > 1) p.set('page', String(n));
  const s = p.toString();
  return s ? `/video?${s}` : '/video';
}

export function videoView(v: VideoView): string {
  const tabs = STATE_FILTERS.map(([k, label]) => html`<a href="${link(k, v.filter.market)}" class="${v.filter.state === k ? 'on' : ''}">${label}</a>`);
  const marketOpts: [string, string][] = [['', 'Cả hai'], ...v.markets.map((m): [string, string] => [m, m])];
  const markets = v.markets.length > 1 ? html`<div class="seg">${marketOpts.map(([k, label]) => html`<a href="${link(v.filter.state, k)}" class="${v.filter.market === k ? 'on' : ''}">${label}</a>`)}</div>` : empty;

  const videoCell = (r: ContentRow, i: VideoRowInfo | undefined): Safe => {
    if (i?.reel?.state === 'pending') return reelProgress(r.id, i.reel, v.ctx.csrf ?? '', { compact: true, poll: true });
    if (i?.reel?.state === 'error') return reelErrorBox(i.reel.error ?? 'Lỗi không xác định khi dựng video.');
    if (i?.built) {
      return html`<span>Đã có (bản v${r.current_revision})</span>
        <div class="small"><a href="/contents/${r.id}/reel" target="_blank" rel="noopener">Xem</a> · <a href="/contents/${r.id}/reel" download>Tải MP4</a></div>`;
    }
    if (i?.builtRevision) return html`<span class="muted">Chỉ có bản v${i.builtRevision} cũ</span>`;
    return html`<span class="muted">Chưa dựng</span>`;
  };

  const actionCell = (r: ContentRow, i: VideoRowInfo | undefined): Safe => {
    if (!v.canBuild(r.market)) return html`<span class="muted small">Chỉ xem</span>`;
    // Đang dựng thì không hiện nút dựng (tiến độ và nút hủy nằm ở cột video).
    if (i?.reel?.state === 'pending') return empty;
    if (!v.reelOn) return html`<span class="muted small">Chưa bật dịch vụ</span>`;
    return buildForm(r.id, v.ctx.csrf ?? '', i?.built ? 'Dựng lại' : 'Dựng video', 'video');
  };

  const body: Safe = v.rows.length
    ? html`<div class="table-wrap"><table>
        <thead><tr><th>Mã</th><th>Nội dung</th><th>Thị trường</th><th>Trạng thái bài</th><th>Video 9:16</th><th>Thao tác</th></tr></thead>
        <tbody>${v.rows.map((r) => {
          const i = v.info.get(String(r.id));
          return html`<tr>
            <td class="mono muted">#${r.id}</td>
            <td class="title"><a href="/contents/${r.id}">${i?.headline ?? '(không có tiêu đề)'}</a></td>
            <td>${marketTag(r.market)}</td>
            <td>${status(r.state)}</td>
            <td>${videoCell(r, i)}</td>
            <td>${actionCell(r, i)}</td>
          </tr>`;
        })}</tbody></table></div>`
    : html`<div class="table-wrap"><div class="empty">Không có bài nào khớp bộ lọc.</div></div>`;

  return page(
    { ...v.ctx, title: 'Video 9:16', nav: 'video' },
    html`<div class="page">
      <div class="page-head"><div><h1>Video 9:16</h1><div class="sub">Video dọc 1080×1920 (có lời đọc và phụ đề thì dài theo lời đọc, không thì 15 giây), dựng từ nội dung bài bằng Remotion. Dựng chạy nền; tiến độ tự cập nhật.</div></div>
        <div class="row-gap"><span class="muted">${v.page.total} bài</span><a class="btn" href="${link(v.filter.state, v.filter.market)}">Làm mới</a></div></div>
      ${flashBox(v.flash)}
      ${v.reelOn ? empty : html`<div class="notice err" role="status">Chưa cấu hình dịch vụ Remotion (REMOTION_RENDER_URL), không dựng được video.</div>`}
      <div class="filters"><div class="seg">${tabs}</div>${markets}</div>
      ${body}
      ${pager(v.page, (n) => link(v.filter.state, v.filter.market, n))}
    </div>`,
  );
}
