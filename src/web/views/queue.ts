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
  filter: { state: string; market: string };
  markets: string[];
  now: Date;
  flash?: Flash;
}

const STATE_FILTERS: [string, string][] = [
  ['', 'Tất cả'],
  ['IN_REVIEW', 'Chờ duyệt'],
  ['CHANGES_REQUESTED', 'Cần chỉnh sửa'],
  ['APPROVED', 'Đã duyệt'],
  ['SCHEDULED', 'Đã hẹn giờ'],
  ['REJECTED', 'Đã từ chối'],
];

function link(state: string, market: string): string {
  const q = new URLSearchParams();
  if (state) q.set('state', state);
  if (market) q.set('market', market);
  const s = q.toString();
  return s ? `/queue?${s}` : '/queue';
}

export function queueView(v: QueueView): string {
  const total = Object.values(v.counts).reduce((a, b) => a + b, 0);
  const tabs = STATE_FILTERS.map(([k, label]) => html`<a href="${link(k, v.filter.market)}" class="${v.filter.state === k ? 'on' : ''}">${label} <span class="n">${k ? (v.counts[k] ?? 0) : total}</span></a>`);
  const marketOpts: [string, string][] = [['', 'Cả hai'], ...v.markets.map((m): [string, string] => [m, m])];
  const markets = v.markets.length > 1 ? html`<div class="seg">${marketOpts.map(([k, label]) => html`<a href="${link(v.filter.state, k)}" class="${v.filter.market === k ? 'on' : ''}">${label}</a>`)}</div>` : empty;

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
      <div class="filters"><div class="seg">${tabs}</div>${markets}</div>
      ${body}
    </div>`,
  );
}
