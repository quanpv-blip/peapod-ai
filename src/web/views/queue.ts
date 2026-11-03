import type { ContentRow } from '../../services/contents.ts';
import { OVERDUE_HOURS } from '../../services/stats.ts';
import { FORMAT, marketTag, span, status, when } from '../components.ts';
import { empty, html, type Safe } from '../html.ts';
import { flashBox, page, type Flash, type PageCtx } from '../layout.ts';

export interface RowInfo {
  headline: string;
  claims: number;
  sources: number;
  editedBy: string | null;
}

export interface QueueView {
  ctx: Omit<PageCtx, 'title' | 'nav'>;
  rows: ContentRow[];
  info: Map<string, RowInfo>;
  /** Số bài theo trạng thái trong phạm vi quyền của người dùng (hiện trên các tab lọc). */
  counts: Record<string, number>;
  filter: { state: string; market: string; q: string };
  markets: string[];
  now: Date;
  flash?: Flash;
  /** Có cấu hình khóa Gemini và người dùng duyệt được ít nhất một thị trường: hiện nút tạo bản tin. */
  canGenerate: boolean;
  /** Có cấu hình Trang Meta và là người duyệt: hiện nút hẹn các bài đã duyệt. */
  canPublish: boolean;
}

const STATE_FILTERS: [string, string][] = [
  ['', 'Tất cả'],
  ['IN_REVIEW', 'Chờ duyệt'],
  ['CHANGES_REQUESTED', 'Cần chỉnh sửa'],
  ['APPROVED', 'Đã duyệt'],
  ['SCHEDULED', 'Đã hẹn giờ'],
  ['PUBLISHED', 'Đã đăng'],
  ['REJECTED', 'Đã từ chối'],
  ['CANCELLED', 'Đã hủy'],
  ['FAILED_PUBLISH', 'Lỗi đăng'],
];

function link(state: string, market: string, q = ''): string {
  const p = new URLSearchParams();
  if (state) p.set('state', state);
  if (market) p.set('market', market);
  if (q) p.set('q', q);
  const s = p.toString();
  return s ? `/queue?${s}` : '/queue';
}

export function queueView(v: QueueView): string {
  const total = Object.values(v.counts).reduce((a, b) => a + b, 0);
  const tabs = STATE_FILTERS.map(([k, label]) => html`<a href="${link(k, v.filter.market, v.filter.q)}" class="${v.filter.state === k ? 'on' : ''}">${label} <span class="n">${k ? (v.counts[k] ?? 0) : total}</span></a>`);
  const marketOpts: [string, string][] = [['', 'Cả hai'], ...v.markets.map((m): [string, string] => [m, m])];
  const markets = v.markets.length > 1 ? html`<div class="seg">${marketOpts.map(([k, label]) => html`<a href="${link(v.filter.state, k, v.filter.q)}" class="${v.filter.market === k ? 'on' : ''}">${label}</a>`)}</div>` : empty;
  const hidden = html`<input type="hidden" name="_csrf" value="${v.ctx.csrf}">`;

  const search = html`<form method="get" action="/queue" role="search">
    <input type="hidden" name="state" value="${v.filter.state}"><input type="hidden" name="market" value="${v.filter.market}">
    <input type="search" name="q" value="${v.filter.q}" placeholder="Tìm theo tiêu đề" aria-label="Tìm theo tiêu đề">
    <button class="btn" type="submit">Tìm</button>${v.filter.q ? html`<a class="small" href="${link(v.filter.state, v.filter.market)}">Xóa tìm kiếm</a>` : empty}
  </form>`;

  const generate = v.canGenerate
    ? html`<form method="post" action="/queue/generate">${hidden}
        <select name="market" aria-label="Thị trường">${v.markets.map((m) => html`<option value="${m}">${m}</option>`)}</select>
        <select name="limit" aria-label="Số bài">${[1, 2, 3].map((n) => html`<option value="${n}">${n} bài</option>`)}</select>
        <button class="btn" type="submit">Tạo bản tin mới</button>
      </form>`
    : empty;
  const publish = v.canPublish
    ? html`<form method="post" action="/queue/publish-approved">${hidden}<button class="btn primary" type="submit">Hẹn các bài đã duyệt lên Trang</button></form>`
    : empty;

  const waitCell = (r: ContentRow): Safe => {
    if (r.state !== 'IN_REVIEW') return html`<span class="muted">-</span>`;
    const ms = v.now.getTime() - new Date(r.updated_at).getTime();
    return ms > OVERDUE_HOURS * 3_600_000 ? html`<span class="warn-t">${span(ms)} · quá hạn</span>` : html`${span(ms)}`;
  };

  const body: Safe = v.rows.length
    ? html`<div class="table-wrap"><table>
        <thead><tr><th>Mã</th><th>Nội dung</th><th>Thị trường</th><th>Định dạng</th><th>Trạng thái</th><th>Đang chờ</th><th>Cần kiểm</th><th>Giờ đăng</th><th>Bản</th></tr></thead>
        <tbody>${v.rows.map((r) => {
          const i = v.info.get(String(r.id));
          return html`<tr>
            <td class="mono muted">#${r.id}</td>
            <td class="title"><a href="/contents/${r.id}">${i?.headline ?? '(không có tiêu đề)'}</a>${i?.editedBy ? html`<div class="small muted">Sửa bởi ${i.editedBy}</div>` : empty}</td>
            <td>${marketTag(r.market)}</td>
            <td>${FORMAT[r.format] ?? r.format}</td>
            <td>${status(r.state)}</td>
            <td>${waitCell(r)}</td>
            <td>${i && i.claims ? html`<span class="warn-t">${i.claims} mục</span>` : html`<span class="muted">-</span>`}</td>
            <td>${when(r.scheduled_at, r.market)}</td>
            <td class="mono muted">v${r.current_revision}</td>
          </tr>`;
        })}</tbody></table></div>`
    : html`<div class="table-wrap"><div class="empty">Không có bài nào khớp bộ lọc.</div></div>`;

  return page(
    { ...v.ctx, title: 'Hàng chờ duyệt', nav: 'queue' },
    html`<div class="page">
      <div class="page-head"><div><h1>Hàng chờ duyệt</h1><div class="sub">Xem, chỉnh sửa và duyệt nội dung trước khi đăng</div></div><span class="muted">${v.rows.length} bài hiển thị</span></div>
      ${flashBox(v.flash)}
      <div class="toolbar">${search}<span class="sep"></span>${generate}${publish}</div>
      <div class="filters"><div class="seg">${tabs}</div>${markets}</div>
      ${body}
    </div>`,
  );
}
