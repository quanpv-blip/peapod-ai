import type { QuotaReport } from '../../services/quota.ts';
import type { LimitState } from '../../domain/quota.ts';
import { empty, html, type Safe } from '../html.ts';
import { page, type PageCtx } from '../layout.ts';

const TONE: Record<LimitState, string> = { con: 'ok', 'sap-het': 'warn', het: 'bad', 'chua-ro': '' };
const BAR: Record<LimitState, string> = { con: 'var(--ok)', 'sap-het': 'var(--warn)', het: 'var(--bad)', 'chua-ro': 'var(--ink-4)' };
const vn = (d: Date) => d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function verdictCard(title: string, ok: boolean, reason: string): Safe {
  return html`<div class="verdict ${ok ? 'ok' : 'bad'}">
    <div class="verdict-h"><span class="verdict-dot"></span><span class="small muted">${title}</span></div>
    <div class="verdict-v">${ok ? 'Có thể' : 'Chưa thể'}</div>
    <div class="small">${reason}</div>
  </div>`;
}

function bar(pct: number | null, state: LimitState): Safe {
  const p = pct === null ? 0 : Math.max(0, Math.min(100, pct));
  return html`<div class="meter"><span style="width:${p}%;background:${BAR[state]}"></span></div>`;
}

export function quotaPage(ctx: Omit<PageCtx, 'title' | 'nav'>, r: QuotaReport): string {
  const modelRows: Safe = html`<div class="table-wrap"><table>
    <thead><tr><th>Mô hình</th><th>Lượt hôm nay (ước tính)</th><th>Giới hạn/ngày</th><th>Trạng thái</th><th>Reset</th></tr></thead>
    <tbody>${r.models.map((m) => html`<tr>
      <td class="mono strong">${m.model}</td>
      <td class="nowrap">${m.calls} ${m.hitToday ? html`<span class="tag bad-tag">có lỗi 429 hôm nay</span>` : empty}</td>
      <td class="nowrap">${m.limit}</td>
      <td style="min-width:200px">${bar(m.view.pct, m.view.state)}<span class="status ${TONE[m.view.state]} small">${m.view.label}</span></td>
      <td class="muted nowrap">${vn(m.resetAt)}</td>
    </tr>`)}</tbody></table></div>`;

  const credit = r.credit;
  const creditView = credit.view;
  const creditBlock: Safe = html`<section class="panel"><div class="panel-h"><div>Credit Gemini<div class="small muted" style="font-weight:400">Google không cho đọc số dư qua API. Nhập số dư từ AI Studio/Google Cloud; hệ thống trừ dần theo chi phí ghi nhận.</div></div></div>
    <div class="panel-b">
      <dl class="facts">
        <dt>Số dư nhập tay</dt><dd>${credit.balanceUsd > 0 ? `${credit.balanceUsd.toFixed(2)} USD` : 'Chưa nhập'}</dd>
        <dt>Nhập ngày</dt><dd>${credit.asOf || '-'}</dd>
        <dt>Đã dùng từ đó (ước tính)</dt><dd>${credit.spentSinceUsd.toFixed(4)} USD</dd>
        <dt>Còn lại (ước tính)</dt><dd><span class="status ${TONE[creditView.state]}">${creditView.label}</span></dd>
      </dl>
      <div class="hint" style="margin-top:14px">Muốn cập nhật số dư: vào <a href="/settings">Cài đặt</a> → mục Hạn mức AI. Số liệu chính xác luôn lấy ở Google Cloud Billing.</div>
    </div></section>`;

  const meta = r.meta;
  const metaBlock: Safe = html`<section class="panel"><div class="panel-h"><div>Trang Facebook (Meta)<div class="small muted" style="font-weight:400">Giới hạn bài đăng qua API và lượt gọi.</div></div></div>
    <div class="panel-b">
      ${meta.configured ? empty : html`<div class="notice warn">Chưa cấu hình Trang Meta.</div>`}
      <div class="small muted">Bài đã hẹn qua API trong 24 giờ</div>
      <div class="kpi-v" style="font-size:24px;margin:6px 0">${meta.posts24h}<small>/ 30</small></div>
      ${bar(meta.postView.pct, meta.postView.state)}
      <div class="small" style="margin-top:6px"><span class="status ${TONE[meta.postView.state]}">${meta.postView.label}</span></div>
      <dl class="facts" style="margin-top:16px">
        <dt>Lượt gọi (BUC)</dt><dd>${meta.bucPct === null ? 'Chưa có số liệu' : `${meta.bucPct}%`}</dd>
        <dt>Đo lúc</dt><dd>${meta.bucCheckedAt ? vn(new Date(meta.bucCheckedAt)) : '-'}</dd>
        <dt>Tạm dừng do lượt gọi</dt><dd>${meta.bucPausedUntil ? `đến ${vn(meta.bucPausedUntil)}` : 'Không'}</dd>
      </dl>
    </div></section>`;

  const v = r.verdict;
  return page(
    { ...ctx, title: 'Hạn mức & credit', nav: 'quota' },
    html`<div class="page">
      <div class="page-head"><div><div class="crumb">Công việc</div><h1>Hạn mức & credit</h1><div class="sub">Còn có thể tạo bài và đăng không? Số liệu ước tính từ chính hệ thống, cập nhật mỗi lần tải lại trang.</div></div>
        <a class="btn" href="/quota">Làm mới</a></div>
      <div class="verdicts">
        ${verdictCard('Tạo bài bằng AI', v.canGenerate, v.generateReason)}
        ${verdictCard('Hẹn bài lên Trang', v.canPost, v.postReason)}
      </div>
      <section class="panel"><div class="panel-h"><div>Gemini · hạn mức theo ngày<div class="small muted" style="font-weight:400">Đếm lượt thành công trong ngày theo giờ Thái Bình Dương (nơi Google reset hạn mức). Lượt bị lỗi không được đếm.</div></div></div>
        <div class="panel-b">${modelRows}</div></section>
      <div class="cols">${creditBlock}${metaBlock}</div>
      <p class="small muted">Lưu ý: hạn mức thật do Google/Meta quyết định và có thể khác con số ước tính (ví dụ lượt bị lỗi ngoài hệ thống). Khi nghi ngờ, đối chiếu AI Studio, Google Cloud Billing và Meta Business Suite.</p>
    </div>`,
  );
}
