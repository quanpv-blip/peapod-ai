import { languageMatchesMarket } from '../../domain/package.ts';
import type { ContentDetail } from '../../services/contents.ts';
import { ACTION, FORMAT, marketTag, status, when, zoneLabel } from '../components.ts';
import { empty, html, type Safe } from '../html.ts';
import { flashBox, page, type Flash, type PageCtx } from '../layout.ts';
import type { DiffOp, PackageDiff } from '../../domain/diff.ts';

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
  /** Có cấu hình Trang Meta và bài đang APPROVED: hiện nút hẹn lên Trang ngay. */
  canPublish: boolean;
  /** Liên kết tới bài trên Facebook khi đã có ID bài. */
  fbUrl?: string;
  /** Bài đã có ảnh thẻ cho bản hiện tại. */
  hasCard?: boolean;
  /** Video Reels 9:16: trạng thái dựng, đã có video chưa, đã bật dịch vụ chưa, người xem có được dựng không. */
  reel?: { status: { state: 'pending' | 'ready' | 'error'; error?: string } | null; hasVideo: boolean; configured: boolean; canGenerate: boolean };
  /** Khác biệt với bản trước (nếu có). */
  changes?: PackageDiff;
}

function reelPanel(v: DetailView): Safe {
  const r = v.reel;
  if (!r) return empty;
  const id = v.d.item.id;
  return html`<div class="panel"><div class="panel-h">Video Reels (9:16)</div><div class="panel-b">
    ${r.hasVideo ? html`<video class="reel-prev" controls playsinline preload="metadata" src="/contents/${id}/reel"></video>
      <p class="small"><a href="/contents/${id}/reel" download>Tải video (MP4)</a></p>` : html`<p class="hint">Chưa có video. Video là ảnh dọc 1080×1920, 15 giây, dựng từ cùng nội dung bài.</p>`}
    ${r.status?.state === 'pending' ? html`<div class="notice">Đang dựng video, thường mất 10–60 giây. Tải lại trang sau ít phút.</div>` : empty}
    ${r.status?.state === 'error' ? html`<div class="notice err">Dựng video lỗi: ${r.status.error ?? 'không rõ'}</div>` : empty}
    ${!r.configured ? html`<p class="hint">Chưa bật dịch vụ Remotion (REMOTION_RENDER_URL), nên chưa dựng được video.</p>` : empty}
    ${r.canGenerate && r.configured && r.status?.state !== 'pending' ? html`<form method="post" action="/contents/${id}/reel">
      <input type="hidden" name="_csrf" value="${v.csrf}">
      <button class="btn" type="submit">${r.hasVideo ? 'Dựng lại video' : 'Dựng video 9:16'}</button></form>` : empty}
  </div></div>`;
}

function diffPanel(c?: PackageDiff): Safe {
  if (!c) return empty;
  const block = (title: string, ops: DiffOp[]): Safe =>
    ops.some((o) => o.type !== 'eq')
      ? html`<div class="diff-b"><div class="small muted">${title}</div><div class="diff">${ops.map((o) => html`<div class="d-${o.type}">${o.type === 'add' ? '+ ' : o.type === 'del' ? '− ' : '  '}${o.text}</div>`)}</div></div>`
      : empty;
  return html`<section class="panel"><div class="panel-h">So với bản trước</div><div class="panel-b">
    ${c.changed ? html`${block('Tiêu đề', c.headline)}${block('Thân bài', c.body)}${block('Lời kêu gọi', c.call_to_action)}${block('Hashtag', c.hashtags)}` : html`<span class="muted small">Không có thay đổi nội dung so với bản trước.</span>`}
  </div></section>`;
}

// Bài đã hẹn giờ trên Meta không sửa được: phải hủy hẹn giờ trước (xem services/publish.ts).
const EDITABLE = ['IN_REVIEW', 'APPROVED'];

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

  const publishBox = v.canPublish
    ? html`<div class="panel"><div class="panel-h">Đăng lên Trang</div><div class="panel-b">
        <p class="small muted">Hẹn bài này lên Trang ngay theo giờ đã duyệt. Bài sẽ được Meta tự đăng đúng giờ.</p>
        <form method="post" action="/contents/${it.id}/publish">${hidden}
          <button class="btn primary" type="submit">Hẹn lên Trang ngay</button>
        </form></div></div>`
    : empty;

  const cancelable =v.can.cancel && ['IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED'].includes(it.state);
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
    ${v.fbUrl ? html`<dt>Trên Facebook</dt><dd><a href="${v.fbUrl}" target="_blank" rel="noopener noreferrer">Mở bài</a></dd>` : empty}
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
          <div class="panel"><div class="panel-h">Xem trước bài đăng</div><div class="panel-b">${preview}${v.hasCard ? html`<div class="card-prev"><img src="/contents/${it.id}/card" alt="Ảnh thẻ của bài" width="540" height="675" loading="lazy"><div class="small muted">Ảnh thẻ dựng tự động. Đây là ảnh sẽ đăng kèm bài.</div></div>` : empty}</div></div>
          ${reelPanel(v)}
          ${diffPanel(v.changes)}${sources}${editForm}
        </div>
        <aside>${decision}${publishBox}${facts}<div class="panel"><div class="panel-h">Kiểm tra tự động</div><div class="panel-b">${checks}<p class="hint">Kiểm tra tự động không thay thế việc đọc kỹ nội dung.</p></div></div>${cancelBox}${history}</aside>
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
