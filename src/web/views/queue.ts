import type { ContentRow } from '../../services/contents.ts';
import type { Page } from '../../domain/paging.ts';
import { GRADE_TEXT, type Quality } from '../../domain/quality.ts';
import type { GenJobView } from '../../services/genJobs.ts';
import { OVERDUE_HOURS } from '../../services/stats.ts';
import { FORMAT, marketTag, pager, span, status, when } from '../components.ts';
import { empty, html, type Safe } from '../html.ts';
import { flashBox, page, type Flash, type PageCtx } from '../layout.ts';

export interface RowInfo {
  headline: string;
  claims: number;
  sources: number;
  editedBy: string | null;
  quality: Quality;
  /** Đủ điều kiện duyệt hàng loạt (điểm tốt, không khẳng định cần kiểm, không lỗi nặng). */
  bulkOk: boolean;
}

export interface QueueView {
  ctx: Omit<PageCtx, 'title' | 'nav'>;
  rows: ContentRow[];
  info: Map<string, RowInfo>;
  /** Số bài theo trạng thái trong phạm vi quyền của người dùng (hiện trên các tab lọc). */
  counts: Record<string, number>;
  filter: { state: string; market: string; q: string };
  /** Trang hiện tại của danh sách (đã lọc theo quyền và bộ lọc). */
  page: Page;
  markets: string[];
  now: Date;
  flash?: Flash;
  /** Có cấu hình khóa Gemini và người dùng duyệt được ít nhất một thị trường: hiện nút tạo bản tin. */
  canGenerate: boolean;
  /** Có cấu hình Trang Meta và là người duyệt: hiện nút hẹn các bài đã duyệt. */
  canPublish: boolean;
  /** Việc tạo bản tin chạy nền gần đây (đang chạy hoặc vừa xong). */
  genJobs: GenJobView[];
  /** Người xem có thể duyệt/từ chối hàng loạt. */
  canBulk: boolean;
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

function link(state: string, market: string, q = '', page = 1): string {
  const p = new URLSearchParams();
  if (state) p.set('state', state);
  if (market) p.set('market', market);
  if (q) p.set('q', q);
  if (page > 1) p.set('page', String(page));
  const s = p.toString();
  return s ? `/queue?${s}` : '/queue';
}

const qChip = (q: Quality): Safe => html`<span class="qchip q-${q.grade}" title="${q.issues.length ? q.issues.map((i) => i.text).join(' · ') : 'Không phát hiện vấn đề'}">${q.score} · ${GRADE_TEXT[q.grade]}</span>`;

function genPanel(jobs: GenJobView[]): Safe {
  if (jobs.length === 0) return empty;
  const j = jobs[0]!;
  const running = j.state === 'running';
  return html`<div class="gen-panel ${j.state}" data-gen-poll="/queue/generate/status" data-gen-running="${running ? '1' : '0'}" role="status">
    <div class="reel-row"><b data-gen-text>${j.text}</b><span class="muted small" data-gen-time>${running ? `đã chạy ${j.elapsedSec} giây` : `mất ${j.elapsedSec} giây`}</span></div>
    ${running ? html`<progress class="reel-bar" data-gen-bar max="100" value="${j.pct}"></progress><div class="small muted">Chạy nền, bạn có thể rời trang. Bài mới sẽ xuất hiện trong hàng chờ.</div>` : empty}
    ${!running && j.reasons.length ? html`<details class="more"><summary>Vì sao có mục không tạo được</summary><ul>${j.reasons.map((r) => html`<li class="small">${r}</li>`)}</ul></details>` : empty}
  </div>`;
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

  const genRunning = v.genJobs.some((j) => j.state === 'running');
  const generate = v.canGenerate
    ? html`<form method="post" action="/queue/generate">${hidden}
        <select name="market" aria-label="Thị trường">${v.markets.map((m) => html`<option value="${m}">${m}</option>`)}</select>
        <select name="limit" aria-label="Số bài">${[1, 2, 3].map((n) => html`<option value="${n}">${n} bài</option>`)}</select>
        <button class="btn" type="submit"${genRunning ? ' disabled' : ''}>${genRunning ? 'Đang tạo…' : 'Tạo bản tin mới'}</button>
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

  const selectable = (r: ContentRow) => v.canBulk && r.state === 'IN_REVIEW';
  const anySelectable = v.rows.some(selectable);
  const body: Safe = v.rows.length
    ? html`<div class="table-wrap"><table>
        <thead><tr>${anySelectable ? html`<th class="chk"><input type="checkbox" data-bulk-all aria-label="Chọn tất cả bài chờ duyệt"></th>` : empty}<th>Mã</th><th>Nội dung</th><th>Thị trường</th><th>Định dạng</th><th>Trạng thái</th><th>Chất lượng</th><th>Đang chờ</th><th>Cần kiểm</th><th>Giờ đăng</th><th>Bản</th></tr></thead>
        <tbody>${v.rows.map((r) => {
          const i = v.info.get(String(r.id));
          return html`<tr>
            ${anySelectable ? html`<td class="chk">${selectable(r) ? html`<input type="checkbox" name="ids" value="${r.id}" data-ok="${i?.bulkOk ? '1' : '0'}" aria-label="Chọn bài #${r.id}">` : empty}</td>` : empty}
            <td class="mono muted">#${r.id}</td>
            <td class="title"><a href="/contents/${r.id}">${i?.headline ?? '(không có tiêu đề)'}</a>${i?.editedBy ? html`<div class="small muted">Sửa bởi ${i.editedBy}</div>` : empty}</td>
            <td>${marketTag(r.market)}</td>
            <td>${FORMAT[r.format] ?? r.format}</td>
            <td>${status(r.state)}</td>
            <td>${i ? qChip(i.quality) : html`<span class="muted">-</span>`}</td>
            <td>${waitCell(r)}</td>
            <td>${i && i.claims ? html`<span class="warn-t">${i.claims} mục</span>` : html`<span class="muted">-</span>`}</td>
            <td>${when(r.scheduled_at, r.market)}</td>
            <td class="mono muted">v${r.current_revision}</td>
          </tr>`;
        })}</tbody></table></div>
        ${anySelectable ? html`<div class="bulk-bar"><span class="small" data-bulk-count>Chưa chọn bài nào</span>
          <button class="btn" type="button" data-bulk-pick-ok>Chọn bài đạt chất lượng</button>
          <button class="btn primary" type="submit" name="bulk" value="approve" data-bulk-act disabled>Duyệt và hẹn giờ</button>
          <input type="text" name="note" placeholder="Lý do (bắt buộc khi từ chối)" aria-label="Lý do từ chối" maxlength="300">
          <button class="btn danger" type="submit" name="bulk" value="reject" data-bulk-act disabled>Từ chối</button>
          <span class="small muted">Duyệt hàng loạt chỉ nhận bài điểm từ 85, không có khẳng định cần kiểm; giờ đăng chia mỗi bài một ngày làm việc.</span></div>` : empty}`
    : html`<div class="table-wrap"><div class="empty">Không có bài nào khớp bộ lọc.</div></div>`;

  return page(
    { ...v.ctx, title: 'Hàng chờ duyệt', nav: 'queue' },
    html`<div class="page">
      <div class="page-head"><div><h1>Hàng chờ duyệt</h1><div class="sub">Xem, chỉnh sửa và duyệt nội dung trước khi đăng</div></div><span class="muted">${v.page.total} bài khớp bộ lọc</span></div>
      ${flashBox(v.flash)}
      ${genPanel(v.genJobs)}
      <div class="toolbar">${search}<span class="sep"></span>${generate}${publish}</div>
      <div class="filters"><div class="seg">${tabs}</div>${markets}</div>
      ${anySelectableForm(v, body, hidden)}
      ${pager(v.page, (n) => link(v.filter.state, v.filter.market, v.filter.q, n))}
    </div>`,
  );
}

/** Bọc bảng trong form duyệt hàng loạt khi có bài chọn được; ngược lại giữ nguyên. */
function anySelectableForm(v: QueueView, body: Safe, hidden: Safe): Safe {
  return v.canBulk && v.rows.some((r) => r.state === 'IN_REVIEW')
    ? html`<form method="post" action="/queue/bulk" data-bulk-form>${hidden}${body}</form>`
    : body;
}
