import { languageMatchesMarket } from '../../domain/package.ts';
import type { ContentDetail } from '../../services/contents.ts';
import { ACTION, FORMAT, marketTag, status, when, zoneLabel } from '../components.ts';
import { empty, html, type Safe } from '../html.ts';
import { flashBox, page, type Flash, type PageCtx } from '../layout.ts';

export interface DetailView {
  ctx: Omit<PageCtx, 'title' | 'nav'>;
  d: ContentDetail;
  csrf: string;
  can: { review: boolean; cancel: boolean };
  /** Người đăng nhập là người sửa cuối của bản hiện tại và thị trường áp dụng bốn mắt. */
  blockedByFourEyes: boolean;
  /** Giờ mặc định cho ô hẹn giờ, dạng datetime-local theo giờ thị trường. */
  scheduleDefault: string;
  draft?: { headline: string; body: string; call_to_action: string; hashtags: string };
  flash?: Flash;
}

const EDITABLE = ['IN_REVIEW', 'APPROVED', 'SCHEDULED'];

export function detailView(v: DetailView): string {
  const { d } = v;
  const it = d.item;
  const p = d.package;
  const canEdit = v.can.review && EDITABLE.includes(it.state);
  const canDecide = v.can.review && it.state === 'IN_REVIEW';
  const hidden = html`<input type="hidden" name="_csrf" value="${v.csrf}">`;

  const preview = html`<div class="fb">
    <div class="fb-h"><div class="fb-av">P</div><div><div class="fb-name">Fanpage ${it.market}</div><div class="fb-sub">Xem trước · cách hiển thị gần đúng trên Facebook</div></div></div>
    <div class="fb-body"><span class="hl">${p.post.headline}</span>${p.post.body}

${p.post.call_to_action}<span class="fb-tags">${p.post.hashtags.join(' ')}</span></div>
    ${mediaCard(d)}
  </div>`;

  const lang = languageMatchesMarket(p.post.body, it.market);
  const checks = html`<ul class="checks">
    ${check(true, 'Đúng cấu trúc dữ liệu (schema)')}
    ${check(lang, it.market === 'JP' ? 'Thân bài bằng tiếng Nhật' : 'Thân bài bằng tiếng Việt')}
    ${check(p.sources.length > 0, `${p.sources.length} nguồn dẫn, tất cả nằm trong danh sách đã thu thập`)}
    ${p.claims_to_verify.length ? check(null, `${p.claims_to_verify.length} khẳng định cần bạn kiểm tra`) : check(true, 'Không có khẳng định cần kiểm')}
    ${check(p.post.body.length <= 2000, `Thân bài ${p.post.body.length}/2000 ký tự`)}
  </ul>`;

  const sources = html`<div class="panel"><div class="panel-h">Nguồn và khẳng định cần kiểm</div><div class="panel-b">
    <h2>Nguồn dẫn</h2>
    <ul>${p.sources.map((s) => html`<li><a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.title}</a> <span class="muted small">${hostOf(s.url)}</span></li>`)}</ul>
    ${p.claims_to_verify.length ? html`<h2>Khẳng định cần kiểm</h2><ol class="claims">${p.claims_to_verify.map((c) => html`<li>${c}</li>`)}</ol>` : empty}
  </div></div>`;

  const dr = v.draft ?? { headline: p.post.headline, body: p.post.body, call_to_action: p.post.call_to_action, hashtags: p.post.hashtags.join(' ') };
  const editForm = canEdit
    ? html`<div class="panel"><div class="panel-h">Chỉnh sửa nội dung</div><div class="panel-b">
        ${it.state !== 'IN_REVIEW' ? html`<div class="notice warn">Bài đã ở trạng thái "${stateText(it.state)}". Lưu chỉnh sửa sẽ hủy duyệt hiện tại và đưa bài về "Chờ duyệt".</div>` : empty}
        <form method="post" action="/contents/${it.id}/edit">${hidden}<input type="hidden" name="revision" value="${it.current_revision}">
          <div class="field"><label for="headline">Tiêu đề</label><input id="headline" name="headline" type="text" maxlength="120" required value="${dr.headline}"></div>
          <div class="field"><label for="body">Thân bài</label><textarea id="body" name="body" class="tall" maxlength="2000" required>${dr.body}</textarea></div>
          <div class="field"><label for="cta">Lời kêu gọi hành động</label><input id="cta" name="call_to_action" type="text" maxlength="200" required value="${dr.call_to_action}"></div>
          <div class="field"><label for="tags">Hashtag</label><input id="tags" name="hashtags" type="text" value="${dr.hashtags}"><div class="hint">Cách nhau bằng dấu cách, tối đa 8.</div></div>
          <button class="btn" type="submit">Lưu chỉnh sửa</button>
        </form></div></div>`
    : empty;

  const needClaims = p.claims_to_verify.length > 0;
  const decision = canDecide
    ? html`<div class="panel"><div class="panel-h">Quyết định</div><div class="panel-b">
        ${v.blockedByFourEyes ? html`<div class="notice warn">Bạn là người sửa cuối của bản này. Thị trường JP yêu cầu một người khác duyệt (bốn mắt).</div>` : empty}
        <form method="post" action="/contents/${it.id}/approve">${hidden}
          <input type="hidden" name="revision" value="${it.current_revision}"><input type="hidden" name="package_hash" value="${d.packageHash}">
          <div class="field"><label for="sched">Giờ đăng (${zoneLabel(it.market)})</label><input id="sched" name="scheduled_at" type="datetime-local" required value="${v.scheduleDefault}"><div class="hint">Cách hiện tại ít nhất 15 phút, trong vòng 29 ngày.</div></div>
          ${needClaims ? html`<label class="check"><input type="checkbox" name="claims_confirmed" value="1"> Tôi đã kiểm tra các khẳng định ở mục "Nguồn và khẳng định cần kiểm".</label>` : empty}
          <button class="btn primary" type="submit"${v.blockedByFourEyes ? ' disabled' : ''}>Duyệt và hẹn giờ</button>
        </form>
        <details class="more"><summary>Yêu cầu chỉnh sửa</summary>
          <form method="post" action="/contents/${it.id}/request-changes">${hidden}
            <div class="field"><label for="rc">Cần sửa điều gì</label><textarea id="rc" name="note" required></textarea></div>
            <button class="btn" type="submit">Gửi yêu cầu</button></form></details>
        <details class="more"><summary>Từ chối</summary>
          <form method="post" action="/contents/${it.id}/reject">${hidden}
            <div class="field"><label for="rj">Lý do</label><textarea id="rj" name="note" required></textarea></div>
            <button class="btn danger" type="submit">Từ chối bài này</button></form></details>
      </div></div>`
    : empty;

  const cancelable = v.can.cancel && ['IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED'].includes(it.state);
  const cancelBox = cancelable
    ? html`<div class="panel"><div class="panel-h">Hủy bài</div><div class="panel-b">
        <form method="post" action="/contents/${it.id}/cancel">${hidden}
          <div class="field"><label for="cc">Ghi chú (không bắt buộc)</label><input id="cc" name="note" type="text"></div>
          <button class="btn danger" type="submit">Hủy bài</button></form></div></div>`
    : empty;

  const facts = html`<div class="panel"><div class="panel-h">Thông tin</div><div class="panel-b"><dl class="facts">
    <dt>Trạng thái</dt><dd>${status(it.state)}</dd>
    <dt>Thị trường</dt><dd>${marketTag(it.market)}</dd>
    <dt>Định dạng</dt><dd>${FORMAT[it.format] ?? it.format}</dd>
    <dt>Giờ đăng</dt><dd>${when(it.scheduled_at, it.market)}</dd>
    <dt>Bản hiện tại</dt><dd>v${it.current_revision} <span class="mono muted">${d.packageHash.slice(0, 10)}</span></dd>
    <dt>Sinh bởi</dt><dd>${d.model ?? '-'}</dd>
    <dt>Sửa lần cuối</dt><dd>${d.editedBy ?? 'AI (chưa ai sửa)'}</dd>
    ${it.last_error ? html`<dt>Lỗi</dt><dd>${it.last_error}</dd>` : empty}
  </dl></div></div>`;

  const history = html`<div class="panel"><div class="panel-h">Lịch sử</div><div class="panel-b">
    ${d.events.length
      ? html`<ul class="timeline">${d.events.map((e) => html`<li><div><span class="who">${ACTION[e.action] ?? e.action}</span> <span class="muted">· v${e.revision}</span></div><div class="small muted">${e.actor} · ${when(e.created_at, it.market)}</div>${e.note ? html`<div class="small">${e.note}</div>` : empty}</li>`)}</ul>`
      : html`<span class="muted">Chưa có thao tác nào.</span>`}
  </div></div>`;

  return page(
    { ...v.ctx, title: `Bài #${it.id}`, nav: 'queue' },
    html`<div class="page">
      <div class="crumb"><a href="/queue">Hàng chờ duyệt</a> / Bài #${it.id}</div>
      <div class="page-head"><h1>${p.post.headline}</h1></div>
      ${flashBox(v.flash)}
      <div class="split">
        <div>
          <div class="panel"><div class="panel-h">Xem trước bài đăng</div><div class="panel-b">${preview}</div></div>
          ${sources}${editForm}
        </div>
        <aside>${decision}${facts}<div class="panel"><div class="panel-h">Kiểm tra tự động</div><div class="panel-b">${checks}<p class="hint">Kiểm tra tự động không thay thế việc đọc kỹ nội dung.</p></div></div>${cancelBox}${history}</aside>
      </div>
    </div>`,
  );
}

function check(pass: boolean | null, text: string): Safe {
  const cls = pass === null ? 'note' : pass ? 'pass' : 'fail';
  const mark = pass === null ? '!' : pass ? '✓' : '✕';
  return html`<li class="${cls}"><span class="k">${mark}</span><span>${text}</span></li>`;
}

function mediaCard(d: ContentDetail): Safe {
  const m = d.package.media as { engine: string; card?: { title?: string; bullets?: string[] } };
  if (m.engine === 'REMOTION_CARD' && m.card) {
    return html`<div class="fb-card"><b>${m.card.title ?? ''}</b><ul>${(m.card.bullets ?? []).map((b) => html`<li>${b}</li>`)}</ul><div class="hint">Ảnh thẻ sẽ được dựng khi có bước tạo media.</div></div>`;
  }
  if (m.engine !== 'NONE') return html`<div class="fb-card"><span class="muted">Media: ${m.engine} (chưa dựng)</span></div>`;
  return empty;
}

function hostOf(u: string): string {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}

const stateText = (s: string) => ({ APPROVED: 'Đã duyệt', SCHEDULED: 'Đã hẹn giờ' })[s] ?? s;
