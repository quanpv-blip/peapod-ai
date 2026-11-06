import type { ContentRow } from '../../services/contents.ts';
import type { Page } from '../../domain/paging.ts';
import { GRADE_TEXT, type Quality } from '../../domain/quality.ts';
import { PILLAR_LABEL, type Pillar, type RiskFlag } from '../../domain/strategy.ts';
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
  pillar: Pillar;
  /** Dấu hiệu rủi ro nội dung (tin sự cố, số liệu, pháp lý...). */
  flags: RiskFlag[];
  /** Mức cần chú ý (cao hơn = đọc trước). */
  attention: number;
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

// Vòng điểm: phần tô tỷ lệ với điểm, màu theo mức; di chuột để xem các vấn đề. Lớp ring-N gán độ đầy mà không cần style nội tuyến.
const qChip = (q: Quality): Safe => html`<span class="row-gap"><span class="ring q-${q.grade} ring-${Math.max(0, Math.min(100, Math.round(q.score)))}" title="${q.issues.length ? q.issues.map((i) => i.text).join(' · ') : 'Không phát hiện vấn đề'}"><b>${q.score}</b></span><span class="small muted">${GRADE_TEXT[q.grade]}</span></span>`;

/** Trụ cột và cờ rủi ro dưới tiêu đề: giúp người duyệt biết bài nào cần đọc kỹ ngay từ danh sách. */
function tags(i: RowInfo): Safe {
  return html`<div class="tags"><span class="tag">${PILLAR_LABEL[i.pillar]}</span>${i.flags.map((f) => html`<span class="tag risk-${f.level}" title="${f.text}">${f.level === 'high' ? '⚠ ' : ''}${FLAG_SHORT[f.code]}</span>`)}</div>`;
}
const FLAG_SHORT: Record<RiskFlag['code'], string> = {
  incident: 'Tin sự cố',
  named_company: 'Nêu tên tổ chức',
  unverified: 'Cần đối chiếu',
  figures: 'Có số liệu',
  legal: 'Pháp lý',
};

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
  // Tab trạng thái đang bằng 0 chỉ gây nhiễu: ẩn, trừ "Tất cả", "Chờ duyệt" và tab đang chọn.
  const tabs = STATE_FILTERS.filter(([k]) => k === '' || k === 'IN_REVIEW' || v.filter.state === k || (v.counts[k] ?? 0) > 0).map(([k, label]) => html`<a href="${link(k, v.filter.market, v.filter.q)}" class="${v.filter.state === k ? 'on' : ''}">${label} <span class="n">${k ? (v.counts[k] ?? 0) : total}</span></a>`);
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
  // Trong trang hiện tại, bài chờ duyệt cần chú ý nhiều nhất (tin sự cố, nhiều khẳng định, điểm thấp) đứng trước.
  const ordered = [...v.rows].sort((a, b) => Number(b.state === 'IN_REVIEW') - Number(a.state === 'IN_REVIEW') || (v.info.get(String(b.id))?.attention ?? 0) - (v.info.get(String(a.id))?.attention ?? 0));
  const body: Safe = v.rows.length
    ? html`<div class="table-wrap"><table>
        <thead><tr>${anySelectable ? html`<th class="chk"><input type="checkbox" data-bulk-all aria-label="Chọn tất cả bài chờ duyệt"></th>` : empty}<th class="col-title">Nội dung</th><th>Trạng thái</th><th>Chất lượng</th><th>Đang chờ</th><th>Giờ đăng</th></tr></thead>
        <tbody>${ordered.map((r) => {
          const i = v.info.get(String(r.id));
          // Vạch màu bên trái dòng theo mức rủi ro: đỏ = cần đọc từng câu, hổ phách = cần đối chiếu.
          const risk = i?.flags.some((f) => f.level === 'high') ? 'r-high' : i?.flags.length ? 'r-med' : '';
          return html`<tr class="${risk}">
            ${anySelectable ? html`<td class="chk">${selectable(r) ? html`<input type="checkbox" name="ids" value="${r.id}" data-ok="${i?.bulkOk ? '1' : '0'}" aria-label="Chọn bài #${r.id}">` : empty}</td>` : empty}
            <td class="title"><a href="/contents/${r.id}">${i?.headline ?? '(không có tiêu đề)'}</a>
              <div class="row-meta">${marketTag(r.market)}<span class="mono muted">#${r.id}</span><span class="muted">${FORMAT[r.format] ?? r.format}</span><span class="mono muted">v${r.current_revision}</span>${i?.editedBy ? html`<span class="muted">sửa bởi ${i.editedBy}</span>` : empty}</div>
              ${i ? tags(i) : empty}</td>
            <td>${status(r.state)}</td>
            <td>${i ? qChip(i.quality) : html`<span class="muted">-</span>`}</td>
            <td>${waitCell(r)}</td>
            <td>${when(r.scheduled_at, r.market)}</td>
          </tr>`;
        })}</tbody></table></div>
        ${anySelectable ? html`<div class="bulk-bar"><span class="small" data-bulk-count>Chưa chọn bài nào</span>
          <button class="btn" type="button" data-bulk-pick-ok>Chọn bài đạt chất lượng</button>
          <button class="btn primary" type="submit" name="bulk" value="approve" data-bulk-act disabled>Duyệt và hẹn giờ</button>
          <input type="text" name="note" placeholder="Lý do (bắt buộc khi từ chối)" aria-label="Lý do từ chối" maxlength="300">
          <button class="btn danger" type="submit" name="bulk" value="reject" data-bulk-act disabled>Từ chối</button></div>` : empty}
        ${anySelectable ? html`<p class="hint">Duyệt hàng loạt chỉ nhận bài điểm từ 85, không có khẳng định cần kiểm và không có cờ rủi ro cao. Giờ đăng chia mỗi bài một ngày làm việc.</p>` : empty}`
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
