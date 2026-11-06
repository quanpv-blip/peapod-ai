import type { AppSettings } from '../../domain/appSettings.ts';
import type { CostSummary } from '../../services/costs.ts';
import { pager } from '../components.ts';
import { empty, html } from '../html.ts';
import { page, type PageCtx } from '../layout.ts';

const usd = (n: number) => `${n.toFixed(3)} USD`;
const pct = (used: number, cap: number) => (cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0);

export function costsPage(ctx: Omit<PageCtx, 'title' | 'nav'>, o: { sum: CostSummary; settings: AppSettings }): string {
  const { sum, settings } = o;
  const dayPct = pct(sum.todayUsd, settings.dailyCapUsd);
  const monthPct = pct(sum.monthUsd, settings.monthlyCapUsd);
  const maxDay = Math.max(0.000001, ...sum.byDay.map((d) => d.costUsd));

  return page(
    { ...ctx, title: 'Chi phí AI', nav: 'costs' },
    html`<div class="page">
      <div class="page-head"><div><div class="crumb">Quản trị</div><h1>Chi phí AI</h1><div class="sub">Ước tính theo đơn giá trong Cài đặt. Múi giờ tính ngày: Việt Nam (ICT).</div></div></div>

      <div class="kpis">
        <div class="kpi"><div class="kpi-l"><i class="c-info"></i>Hôm nay</div><div class="kpi-v">${sum.todayUsd.toFixed(3)}<small>USD</small></div>
          <div class="kpi-s">${settings.dailyCapUsd > 0 ? html`Trần ${usd(settings.dailyCapUsd)} · đã dùng ${dayPct}%` : 'Không giới hạn ngày'}</div>
          ${settings.dailyCapUsd > 0 ? html`<div class="hbar"><span class="w${dayPct}"></span></div>` : empty}</div>
        <div class="kpi"><div class="kpi-l"><i class="c-info"></i>Tháng này</div><div class="kpi-v">${sum.monthUsd.toFixed(3)}<small>USD</small></div>
          <div class="kpi-s">${settings.monthlyCapUsd > 0 ? html`Trần ${usd(settings.monthlyCapUsd)} · đã dùng ${monthPct}%` : 'Không giới hạn tháng'}</div>
          ${settings.monthlyCapUsd > 0 ? html`<div class="hbar"><span class="w${monthPct}"></span></div>` : empty}</div>
        <div class="kpi"><div class="kpi-l"><i class="c-mute"></i>Lượt gọi tháng này</div><div class="kpi-v">${sum.byModel.reduce((a, m) => a + m.calls, 0)}</div>
          <div class="kpi-s">${sum.byModel.length} mô hình đã dùng</div></div>
        <div class="kpi"><div class="kpi-l"><i class="c-ok"></i>Đơn giá đang dùng</div><div class="kpi-v u-fs20">${settings.priceInPerM} / ${settings.priceOutPerM}</div>
          <div class="kpi-s">USD mỗi triệu token (vào / ra)</div></div>
      </div>

      <section class="panel"><div class="panel-h">Chi phí 30 ngày gần nhất</div><div class="panel-b">
            ${sum.byDay.length
              ? html`<div class="daybars">${sum.byDay.slice().reverse().map((d) => html`<div class="dayb" title="${d.day}: ${usd(d.costUsd)}, ${d.calls} lượt">
                  <div class="dayb-col"><span class="h${Math.max(2, Math.round((d.costUsd / maxDay) * 100))}"></span></div>
                  <div class="dayb-l">${d.day.slice(8)}</div></div>`)}</div>`
              : html`<div class="empty">Chưa có lượt gọi AI nào.</div>`}
          </div></section>

      <section class="panel"><div class="panel-h">Theo mô hình (tháng này)</div><div class="panel-b">
            ${sum.byModel.length
              ? html`<div class="table-wrap"><table><thead><tr><th>Mô hình</th><th>Lượt</th><th>Token vào</th><th>Token ra</th><th>Chi phí</th></tr></thead>
                  <tbody>${sum.byModel.map((m) => html`<tr><td class="mono">${m.model}</td><td>${m.calls}</td><td>${m.tokensIn.toLocaleString('vi-VN')}</td><td>${m.tokensOut.toLocaleString('vi-VN')}</td><td class="nowrap">${usd(m.costUsd)}</td></tr>`)}</tbody></table></div>`
              : html`<div class="empty">Chưa có dữ liệu.</div>`}
          </div></section>

      <section class="panel"><div class="panel-h">Lượt gọi AI gần đây<span class="small muted">${sum.recentPage.total} lượt</span></div>
        ${sum.recent.length
          ? html`<div class="table-wrap"><table>
              <thead><tr><th>Thời điểm (ICT)</th><th>Thị trường</th><th>Mục đích</th><th>Mô hình</th><th class="right">Token vào</th><th class="right">Token ra</th><th class="right">Chi phí</th></tr></thead>
              <tbody>${sum.recent.map((r) => html`<tr>
                <td class="nowrap">${r.created_at.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</td>
                <td>${r.market}</td>
                <td>${r.purpose === 'CAMPAIGN' ? 'Chiến dịch' : 'Tin ngành'}</td>
                <td class="mono">${r.model}</td>
                <td class="right">${r.tokens_in.toLocaleString('vi-VN')}</td>
                <td class="right">${r.tokens_out.toLocaleString('vi-VN')}</td>
                <td class="right nowrap">${usd(r.cost_usd)}</td>
              </tr>`)}</tbody></table></div>
            ${pager(sum.recentPage, (n) => `/costs?page=${n}`)}`
          : html`<div class="empty">Chưa có lượt gọi.</div>`}
      </section>
    </div>`,
  );
}
