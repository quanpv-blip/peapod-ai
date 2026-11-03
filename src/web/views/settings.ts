import { settingsToForm, type AppSettings } from '../../domain/appSettings.ts';
import { empty, html, type Safe } from '../html.ts';
import { flashBox, page, type PageCtx } from '../layout.ts';

export interface SettingsOpts {
  settings?: AppSettings;
  /** Giá trị vừa gửi lên (khi lưu lỗi): hiển thị lại đúng những gì người dùng đã nhập. */
  form?: Record<string, string>;
  errors?: string[];
  saved?: boolean;
}

const field = (id: string, label: string, input: Safe, hint?: string): Safe => html`<div class="field">
  <label for="${id}">${label}</label>${input}${hint ? html`<div class="hint">${hint}</div>` : empty}
</div>`;

const panel = (title: string, sub: string, body: Safe): Safe => html`<section class="panel">
  <div class="panel-h"><div><div>${title}</div><div class="small muted" style="font-weight:400">${sub}</div></div></div>
  <div class="panel-b form-grid">${body}</div>
</section>`;

export function settingsPage(ctx: Omit<PageCtx, 'title' | 'nav'>, o: SettingsOpts): string {
  const f = o.form ?? (o.settings ? settingsToForm(o.settings) : {});
  const v = (k: string) => f[k] ?? '';
  const errors = o.errors?.length
    ? html`<div class="notice err" role="alert"><b>Chưa lưu được:</b><ul class="errlist">${o.errors.map((e) => html`<li>${e}</li>`)}</ul></div>`
    : empty;
  const saved = o.saved && !o.errors ? flashBox({ kind: 'ok', text: 'Đã lưu cấu hình. Thay đổi có hiệu lực ở lần chạy kế tiếp.' }) : empty;

  return page(
    { ...ctx, title: 'Cài đặt', nav: 'settings' },
    html`<div class="page">
      <div class="page-head"><div><div class="crumb">Quản trị</div><h1>Cài đặt vận hành</h1><div class="sub">Nguồn tin, lịch chạy, trần chi phí và giới hạn đăng. Chỉ quản trị viên chỉnh.</div></div></div>
      ${saved}${errors}
      <form method="post" action="/settings" class="settings">
        <input type="hidden" name="_csrf" value="${ctx.csrf}">
        ${panel('Nguồn tin (RSS)', 'Mỗi dòng một đường dẫn https. Chỉ các nguồn ở đây được dùng để sinh bản tin.', html`
          ${field('feedsJP', 'Nguồn tiếng Nhật', html`<textarea id="feedsJP" name="feedsJP" rows="4">${v('feedsJP')}</textarea>`)}
          ${field('feedsVN', 'Nguồn tiếng Việt', html`<textarea id="feedsVN" name="feedsVN" rows="4">${v('feedsVN')}</textarea>`)}
        `)}
        ${panel('Lịch chạy', 'Giờ địa phương của từng thị trường. Sinh bản tin chạy một lần mỗi ngày sau giờ này.', html`
          ${field('genCountVN', 'Số bài sinh mỗi lần (VN)', html`<input id="genCountVN" name="genCountVN" type="number" step="1" min="1" max="5" value="${v('genCountVN')}">`, 'Số bản tin tự động sinh mỗi ngày (1–5). Người dùng vẫn tạo bài thủ công được ở trang Tạo bài viết mới.')}
          ${field('genCountJP', 'Số bài sinh mỗi lần (JP)', html`<input id="genCountJP" name="genCountJP" type="number" step="1" min="1" max="5" value="${v('genCountJP')}">`)}
          ${field('genTimeVN', 'Giờ sinh bản tin VN', html`<input id="genTimeVN" name="genTimeVN" type="time" value="${v('genTimeVN')}" required>`)}
          ${field('genTimeJP', 'Giờ sinh bản tin JP', html`<input id="genTimeJP" name="genTimeJP" type="time" value="${v('genTimeJP')}" required>`)}
          ${field('postTimeVN', 'Giờ đăng mặc định VN', html`<input id="postTimeVN" name="postTimeVN" type="time" value="${v('postTimeVN')}" required>`, 'Điền sẵn khi duyệt bài. Người duyệt vẫn chọn được giờ khác.')}
          ${field('postTimeJP', 'Giờ đăng mặc định JP', html`<input id="postTimeJP" name="postTimeJP" type="time" value="${v('postTimeJP')}" required>`)}
        `)}
        ${panel('Chi phí AI', 'Trần chi phí tự động dừng việc sinh bài khi đạt. 0 nghĩa là không giới hạn.', html`
          ${field('dailyCapUsd', 'Trần ngày (USD)', html`<input id="dailyCapUsd" name="dailyCapUsd" type="number" step="0.01" min="0" value="${v('dailyCapUsd')}">`)}
          ${field('monthlyCapUsd', 'Trần tháng (USD)', html`<input id="monthlyCapUsd" name="monthlyCapUsd" type="number" step="0.01" min="0" value="${v('monthlyCapUsd')}">`)}
          ${field('priceInPerM', 'Đơn giá token vào (USD / 1 triệu)', html`<input id="priceInPerM" name="priceInPerM" type="number" step="0.0001" min="0" value="${v('priceInPerM')}">`, 'Số cấu hình để ước tính. Đối chiếu trang giá chính thức của nhà cung cấp trước khi tin.')}
          ${field('priceOutPerM', 'Đơn giá token ra (USD / 1 triệu)', html`<input id="priceOutPerM" name="priceOutPerM" type="number" step="0.0001" min="0" value="${v('priceOutPerM')}">`, 'Token suy luận được tính như token ra.')}
        `)}
        ${panel('Hạn mức AI', 'Giới hạn yêu cầu mỗi ngày cho từng mô hình (gói miễn phí Gemini: 20, đối chiếu AI Studio) và số dư credit nhập tay để hệ thống ước tính.', html`
          ${field('aiRequestLimit', 'Giới hạn yêu cầu AI mỗi ngày (mỗi mô hình)', html`<input id="aiRequestLimit" name="aiRequestLimit" type="number" step="1" min="1" value="${v('aiRequestLimit')}">`)}
          ${field('aiCreditUsd', 'Số dư credit Gemini (USD)', html`<input id="aiCreditUsd" name="aiCreditUsd" type="number" step="0.01" min="0" value="${v('aiCreditUsd')}">`, 'Nhập từ Google Cloud Billing hoặc AI Studio. Đặt 0 nếu không dùng credit trả trước.')}
          ${field('aiCreditAsOf', 'Ngày nhập số dư', html`<input id="aiCreditAsOf" name="aiCreditAsOf" type="date" value="${v('aiCreditAsOf')}">`, 'Hệ thống chỉ trừ chi phí phát sinh từ ngày này.')}
        `)}
        ${panel('Giới hạn đăng Meta', 'Khi lượt gọi Meta vượt ngưỡng, hệ thống tạm dừng hẹn bài mới (BUC).', html`
          ${field('bucPausePct', 'Ngưỡng tạm dừng (%)', html`<input id="bucPausePct" name="bucPausePct" type="number" step="1" min="1" max="100" value="${v('bucPausePct')}">`)}
        `)}
        ${panel('Tự động duyệt (chỉ VN)', 'Bật thì bài VN đạt đủ điều kiện được tự duyệt và tự hẹn lên Trang. Điều kiện: nguồn RSS đã cấu hình, không có khẳng định cần kiểm, có ảnh thẻ, không phải tin sự cố bảo mật, và chưa có người sửa. JP luôn duyệt tay.', html`
          <div class="field full"><label class="check"><input type="checkbox" name="autoApproveVN" value="on"${v('autoApproveVN') === 'on' ? ' checked' : ''}> Bật tự duyệt bài VN</label></div>
          ${field('autoApproveDailyMax', 'Số bài tự duyệt tối đa mỗi ngày', html`<input id="autoApproveDailyMax" name="autoApproveDailyMax" type="number" step="1" min="0" max="20" value="${v('autoApproveDailyMax')}">`, 'Đặt 0 để tạm tắt mà không cần bỏ tick.')}
        `)}
        ${panel('Bài chiến dịch','Tên miền được phép làm nguồn cho bài chiến dịch. Hệ thống không tự tải trang; người dùng dán nội dung nguồn.', html`
          <div class="field full">${html`<label for="campaignDomains">Tên miền được phép</label><textarea id="campaignDomains" name="campaignDomains" rows="3">${v('campaignDomains')}</textarea><div class="hint">Mỗi dòng một tên miền, ví dụ vnexpress.net. Cả tên miền con cũng được phép.</div>`}</div>
        `)}
        <div class="savebar"><button class="btn primary" type="submit">Lưu cấu hình</button></div>
      </form>
    </div>`,
  );
}
