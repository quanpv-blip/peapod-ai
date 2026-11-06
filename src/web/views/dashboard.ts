import { OVERDUE_HOURS, type Stats } from '../../services/stats.ts';
import { marketTag, span, STATE, when } from '../components.ts';
import { empty, html, type Safe } from '../html.ts';
import { flashBox, page, type Flash, type PageCtx } from '../layout.ts';
import type { AuditRow } from './audit.ts';
import { ACTION, actorLabel } from '../components.ts';
import { bestSlot, engagement, MIN_POSTS_PER_SLOT, summarize, type PostMetric } from '../../domain/insights.ts';

export interface SystemView {
  metaOn: boolean;
  geminiOn: boolean;
  paused: boolean;
  isAdmin: boolean;
  flash?: Flash;
}

const TONE_BG: Record<string, string> = { '': 'c-mute-bg', ok: 'c-ok-bg', warn: 'c-warn-bg', bad: 'c-bad-bg', info: 'c-info-bg' };
const ORDER = ['IN_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'GENERATING', 'MEDIA_PENDING', 'REJECTED', 'CANCELLED', 'FAILED_GENERATE', 'FAILED_MEDIA', 'FAILED_PUBLISH'];

const pct = (n: number, of: number) => (of ? Math.round((n / of) * 100) : 0);
const sum = (o: Record<string, number>, keys?: string[]) => Object.entries(o).filter(([k]) => !keys || keys.includes(k)).reduce((a, [, v]) => a + v, 0);

function kpi(label: string, tone: string, value: string | number, unit: string, sub: Safe | string): Safe {
  return html`<div class="kpi"><div class="kpi-l"><i class="c-${tone}"></i>${label}</div><div class="kpi-v">${value}<small>${unit}</small></div><div class="kpi-s">${sub}</div></div>`;
}

export function dashboardView(ctx: Omit<PageCtx, 'title' | 'nav'>, s: Stats, recent: AuditRow[], markets: ('VN' | 'JP')[], metrics: PostMetric[], sys?: SystemView): string {
  const dot = (ok: boolean, text: string) => html`<li class="${ok ? 'pass' : 'fail'}"><span class="k">${ok ? '✓' : '✕'}</span><span>${text}</span></li>`;
  const hidden = html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
  // Khối điều khiển hệ thống không chiếm đầu trang: gập lại khi mọi thứ bình thường, mở sẵn khi đang tạm dừng hoặc thiếu cấu hình.
  const sysOpen = !!sys && (sys.paused || !sys.metaOn || !sys.geminiOn);
  const sysPanel = sys
    ? html`<details class="panel fold"${sysOpen ? ' open' : ''}><summary class="panel-h">Hệ thống <span class="small muted">${sys.paused ? 'đang tạm dừng' : sysOpen ? 'cần kiểm tra cấu hình' : 'hoạt động bình thường'}</span></summary><div class="panel-b">
        ${flashBox(sys.flash)}
        <ul class="checks">
          ${dot(sys.metaOn, sys.metaOn ? 'Đăng lên Trang Facebook (Meta): đã cấu hình' : 'Đăng lên Trang Facebook (Meta): chưa cấu hình')}
          ${dot(sys.geminiOn, sys.geminiOn ? 'Sinh bản tin bằng AI (Gemini): đã cấu hình' : 'Sinh bản tin bằng AI (Gemini): chưa cấu hình')}
          ${dot(!sys.paused, sys.paused ? 'Công tắc tạm dừng: ĐANG BẬT' : 'Công tắc tạm dừng: tắt, hoạt động bình thường')}
        </ul>
        ${sys.isAdmin
          ? sys.paused
            ? html`<form method="post" action="/admin/pause" class="actions u-mt12">${hidden}<input type="hidden" name="action" value="resume"><button class="btn" type="submit">Tắt công tắc, cho hoạt động lại</button></form>`
            : html`<form class="u-mt12" method="post" action="/admin/pause">${hidden}<input type="hidden" name="action" value="pause">
                <label class="check"><input type="checkbox" name="confirm" value="1" required> Tôi hiểu: bật công tắc sẽ dừng hẹn bài mới lên Trang và sinh bài mới. Hủy bài và đối soát vẫn chạy.</label>
                <button class="btn danger" type="submit">Bật công tắc tạm dừng</button></form>`
          : empty}
        ${sys.isAdmin
          ? html`<form method="post" action="/admin/alert-test" class="actions u-mt12">${hidden}<button class="btn" type="submit">Gửi thử cảnh báo</button><span class="small muted">Gửi một tin thử tới các kênh đã cấu hình (Slack, Telegram).</span></form>`
          : empty}
      </div></details>`
    : empty;
  const total = sum(s.byState);
  const scheduled = sum(s.byState, ['APPROVED', 'SCHEDULED']);
  const published = s.byState['PUBLISHED'] ?? 0;
  const failed = sum(s.byState, ['FAILED_GENERATE', 'FAILED_MEDIA', 'FAILED_PUBLISH']);

  // "Việc cần làm": mỗi dòng là một việc cụ thể kèm đường dẫn, xếp theo mức gấp. Không có việc thì nói rõ.
  const failedPublish = s.byState['FAILED_PUBLISH'] ?? 0;
  const todo: { tone: 'bad' | 'warn' | 'info'; text: Safe | string; href: string; cta: string }[] = [];
  if (sys?.paused) todo.push({ tone: 'bad', text: 'Hệ thống đang tạm dừng: không hẹn bài mới và không sinh bài mới.', href: '#he-thong', cta: 'Xem công tắc' });
  if (failed) todo.push({ tone: 'bad', text: `${failed} bài bị lỗi, cần xử lý.`, href: failedPublish ? '/queue?state=FAILED_PUBLISH' : '/queue', cta: 'Mở danh sách lỗi' });
  if (s.pending.overdue) todo.push({ tone: 'warn', text: `${s.pending.overdue} bài chờ duyệt đã quá ${OVERDUE_HOURS} giờ.`, href: '/queue?state=IN_REVIEW', cta: 'Duyệt ngay' });
  if (s.upcoming[0]) todo.push({ tone: 'info', text: html`Bài kế tiếp lên Trang lúc ${when(s.upcoming[0].scheduled_at, s.upcoming[0].market)}.`, href: `/contents/${s.upcoming[0].id}`, cta: 'Xem bài' });
  const todoCard = html`<section class="hero" aria-label="Việc cần làm hôm nay">
    <div>
      <div class="hero-k">Cần bạn duyệt hôm nay</div>
      <div class="hero-v">${s.pending.count}<small>bài</small></div>
      <p class="hero-s">${s.pending.count
        ? html`Bài lâu nhất đã chờ <b>${span(s.pending.oldestWaitMs)}</b>${s.pending.overdue ? html`, trong đó <b>${s.pending.overdue} bài quá ${OVERDUE_HOURS} giờ</b>` : empty}.`
        : 'Không có bài nào đang chờ. Bài mới sẽ xuất hiện ở đây khi hệ thống tạo xong.'}</p>
      <div class="hero-act"><a class="btn primary" href="/queue?state=IN_REVIEW">Mở hàng chờ duyệt</a><a class="btn" href="/create">Tạo bài mới</a></div>
    </div>
    <div>
      ${todo.length
        ? html`<ul class="todo">${todo.map((t) => html`<li class="todo-${t.tone}"><span>${t.text}</span><a class="btn" href="${t.href}">${t.cta}</a></li>`)}</ul>`
        : html`<div class="empty">Không có việc nào khác cần xử lý.</div>`}
    </div>
  </section>`;

  const kpis = html`<div class="kpis">
    ${kpi('Chờ duyệt', 'warn', s.pending.count, 'bài', s.pending.count
      ? html`Lâu nhất ${span(s.pending.oldestWaitMs)}${s.pending.overdue ? html` · <span class="up">${s.pending.overdue} bài quá ${OVERDUE_HOURS} giờ</span>` : empty}`
      : 'Không có bài nào đang chờ')}
    ${kpi('Đã duyệt, chờ đăng', 'info', scheduled, 'bài', s.upcoming[0] ? html`Bài kế tiếp: ${when(s.upcoming[0].scheduled_at, s.upcoming[0].market)}` : 'Chưa có bài hẹn giờ')}
    ${kpi('Đã đăng', 'ok', published, 'bài', failed ? html`<span class="up">${failed} bài lỗi cần xử lý</span>` : 'Không có bài lỗi')}
    ${kpi('Tỷ lệ duyệt (7 ngày)', 'mute', s.approvalRate === null ? '-' : Math.round(s.approvalRate * 100), s.approvalRate === null ? '' : '%', s.decisions7d ? `${s.decisions7d} quyết định (duyệt, từ chối, yêu cầu sửa)` : 'Chưa có quyết định nào')}
  </div>`;

  const usd = (n: number) => (n >= 1 ? n.toFixed(2) : n.toFixed(3));
  const aiCard = html`<div class="panel"><div class="panel-h">Hiệu quả AI <span class="muted small">30 ngày gần nhất</span></div><div class="panel-b">
    <table class="split-t"><tbody>
      <tr><td>Bài AI tạo ra</td><td>${s.ai.created}</td></tr>
      <tr><td>Bài được duyệt</td><td>${s.ai.approved}${s.ai.passRate === null ? '' : html` <span class="muted small">(${Math.round(s.ai.passRate * 100)}% số bài tạo)</span>`}</td></tr>
      <tr><td>Bài đã đăng</td><td>${s.ai.published}</td></tr>
      <tr><td>Chi phí AI</td><td>${usd(s.ai.spendUsd)} USD</td></tr>
      <tr><td>Chi phí mỗi bài được duyệt</td><td>${s.ai.costPerApprovedUsd === null ? '-' : `${usd(s.ai.costPerApprovedUsd)} USD`}</td></tr>
      <tr><td>Từ lúc tạo đến lúc duyệt (trung bình)</td><td>${s.ai.avgHoursToApprove === null ? '-' : span(s.ai.avgHoursToApprove * 3_600_000)}</td></tr>
      <tr><td>Bài đã có video 9:16</td><td>${s.ai.videos}</td></tr>
    </tbody></table>
  </div></div>`;

  const sum30 = summarize(metrics);
  const slotText = (m: 'VN' | 'JP') => {
    const b = bestSlot(metrics, m);
    return b ? `${m}: đăng lúc ${String(b.hour).padStart(2, '0')}:00 hiệu quả nhất (trung bình ${Math.round(b.avg)} điểm/bài, ${b.posts} bài)` : `${m}: chưa đủ dữ liệu (cần ít nhất ${MIN_POSTS_PER_SLOT} bài cùng khung giờ)`;
  };
  const insightCard = html`<div class="panel"><div class="panel-h">Hiệu quả bài đăng <span class="muted small">30 ngày, số liệu từ Facebook</span></div><div class="panel-b">
    ${sum30.posts
      ? html`<table class="split-t"><tbody>
          <tr><td>Bài có số liệu</td><td>${sum30.posts}</td></tr>
          <tr><td>Phản ứng · Bình luận · Chia sẻ</td><td>${sum30.reactions} · ${sum30.comments} · ${sum30.shares}</td></tr>
          <tr><td>Lượt hiển thị</td><td>${sum30.impressions === null ? 'chưa có' : sum30.impressions}</td></tr>
          <tr><td>Điểm tương tác trung bình</td><td>${Math.round(sum30.avgEngagement ?? 0)}</td></tr>
        </tbody></table>
        <h3 class="sub-h">Bài nổi bật</h3>
        <ul class="list">${sum30.top.map((m) => html`<li><div class="what"><a href="/contents/${m.id}">${m.headline}</a><span class="muted small">${marketTag(m.market)} · ${engagement(m)} điểm (${m.reactions} thích, ${m.comments} bình luận, ${m.shares} chia sẻ)</span></div></li>`)}</ul>
        <h3 class="sub-h">Gợi ý giờ đăng</h3>
        <ul>${markets.map((m) => html`<li class="small">${slotText(m)}</li>`)}</ul>
        <p class="hint">Điểm tương tác = thích + 3 × bình luận + 5 × chia sẻ.</p>`
      : html`<div class="empty">Chưa có số liệu. Hệ thống đọc từ Meta mỗi 2 giờ sau khi bài được đăng.</div>`}
  </div></div>`;

  const present = ORDER.filter((k) => (s.byState[k] ?? 0) > 0);
  const stateCard = html`<div class="panel"><div class="panel-h">Phân bố theo trạng thái <span class="muted small">${total} bài</span></div><div class="panel-b">
    ${total
      ? html`<div class="stack">${present.map((k) => html`<span class="${TONE_BG[STATE[k]?.tone ?? '']} w${pct(s.byState[k]!, total)}" title="${STATE[k]?.text ?? k}"></span>`)}</div>
        <div class="legend">${present.map((k) => html`<div><i class="${TONE_BG[STATE[k]?.tone ?? '']}"></i>${STATE[k]?.text ?? k}<b>${s.byState[k]}</b></div>`)}</div>`
      : html`<div class="empty">Chưa có bài nào.</div>`}
  </div></div>`;

  const marketCard = html`<div class="panel"><div class="panel-h">Theo thị trường</div><div class="panel-b">
    <table class="split-t"><thead><tr><th></th>${markets.map((m) => html`<th>${m}</th>`)}</tr></thead><tbody>
      ${[['Tổng số bài', null], ['Chờ duyệt', ['IN_REVIEW']], ['Đã duyệt / hẹn giờ', ['APPROVED', 'SCHEDULED']], ['Đã đăng', ['PUBLISHED']], ['Từ chối / hủy', ['REJECTED', 'CANCELLED']]].map(
        ([label, keys]) => html`<tr><td>${label as string}</td>${markets.map((m) => html`<td>${sum(s.byMarket[m], (keys as string[] | null) ?? undefined)}</td>`)}</tr>`,
      )}
    </tbody></table>
  </div></div>`;

  const maxDay = Math.max(1, ...s.daily.map((d) => d.approve + d.other));
  const chart = html`<div class="panel"><div class="panel-h">Hoạt động 7 ngày qua <span class="muted small">giờ ICT</span></div><div class="panel-b">
    <div class="bars">${s.daily.map((d) => html`<div class="bar"><div class="bar-n">${d.approve + d.other || ''}</div><div class="bar-col">
        <span class="c-mute-bg h${pct(d.other, maxDay)}"></span><span class="c-ok-bg h${pct(d.approve, maxDay)}"></span></div><div class="bar-l">${d.label}</div></div>`)}</div>
    <div class="key"><span><i class="c-ok-bg"></i>Duyệt</span><span><i class="c-mute-bg"></i>Sửa, từ chối, yêu cầu sửa, hủy</span></div>
  </div></div>`;

  const upcoming = html`<div class="panel"><div class="panel-h">Sắp đăng</div><div class="panel-b">
    ${s.upcoming.length
      ? html`<ul class="list">${s.upcoming.map((u) => html`<li><div class="when">${when(u.scheduled_at, u.market)}</div><div class="what"><a href="/contents/${u.id}">${u.headline}</a><span class="muted small">${marketTag(u.market)} #${u.id}</span></div></li>`)}</ul>`
      : html`<div class="empty">Chưa có bài nào được hẹn giờ.</div>`}
  </div></div>`;

  const activity = html`<div class="panel"><div class="panel-h">Hoạt động gần đây <a class="small" href="/audit">Xem tất cả</a></div><div class="panel-b">
    ${recent.length
      ? html`<ul class="list">${recent.map((r) => html`<li><div class="when">${when(r.created_at, r.market)}</div><div class="what"><span>${ACTION[r.action] ?? r.action} · <a href="/contents/${r.content_id}">#${r.content_id}</a></span><span class="muted small">${actorLabel(r.actor)}</span></div></li>`)}</ul>`
      : html`<div class="empty">Chưa có thao tác nào.</div>`}
  </div></div>`;

  return page(
    { ...ctx, title: 'Tổng quan', nav: 'dash' },
    html`<div class="page">
      <div class="page-head"><div><h1>Tổng quan</h1><div class="sub">Tình hình duyệt và đăng bài của ${markets.join(' và ')}</div></div></div>
      ${todoCard}
      ${kpis}
      <div id="he-thong">${sysPanel}</div>
      <div class="cols"><div>${stateCard}${chart}${insightCard}${aiCard}</div><div>${upcoming}${marketCard}${activity}</div></div>
    </div>`,
  );
}
