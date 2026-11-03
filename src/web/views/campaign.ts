import type { Market } from '../../domain/package.ts';
import { empty, html } from '../html.ts';
import { flashBox, page, type Flash, type PageCtx } from '../layout.ts';

export interface CampaignOpts {
  markets: Market[];
  domains: string[];
  aiOn: boolean;
  form?: { market: string; topic: string; sourceUrl: string; sourceText: string; note: string };
  flash?: Flash;
}

export function campaignPage(ctx: Omit<PageCtx, 'title' | 'nav'>, o: CampaignOpts): string {
  const f = o.form ?? { market: '', topic: '', sourceUrl: '', sourceText: '', note: '' };
  const hidden = html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
  const blocked = !o.aiOn || o.markets.length === 0;

  return page(
    { ...ctx, title: 'Chiến dịch chủ đề', nav: 'campaign' },
    html`<div class="page">
      <div class="page-head"><div><div class="crumb">Công việc</div><h1>Chiến dịch chủ đề</h1><div class="sub">Viết một bài theo chủ đề bạn chọn, dựa trên một nguồn cụ thể. Bài đi vào hàng chờ duyệt như mọi bài khác.</div></div></div>
      ${flashBox(o.flash)}
      <div class="cols">
        <section class="panel"><div class="panel-h">Tạo bài mới</div><div class="panel-b">
          ${blocked
            ? html`<div class="notice warn">${!o.aiOn ? 'Chưa cấu hình khóa Gemini (GEMINI_API_KEY), nên chưa tạo được bài.' : 'Tài khoản của bạn chưa có quyền duyệt thị trường nào, nên không tạo được bài.'}</div>`
            : html`<form method="post" action="/campaign" class="form-grid">${hidden}
                <div class="field"><label for="market">Thị trường</label>
                  <select id="market" name="market">${o.markets.map((m) => html`<option value="${m}"${f.market === m ? ' selected' : ''}>${m}</option>`)}</select></div>
                <div class="field"><label for="topic">Chủ đề</label>
                  <input id="topic" name="topic" type="text" required maxlength="60" value="${f.topic}" placeholder="Ví dụ: Chuyển đổi số ngành vận tải">
                  <div class="hint">Tối đa 60 ký tự. Chủ đề định hướng góc nhìn của bài.</div></div>
                <div class="field full"><label for="sourceUrl">Đường dẫn nguồn</label>
                  <input id="sourceUrl" name="sourceUrl" type="url" required value="${f.sourceUrl}" placeholder="https://...">
                  <div class="hint">Phải là https và thuộc tên miền được phép: ${o.domains.join(', ')}.</div></div>
                <div class="field full"><label for="sourceText">Nội dung nguồn</label>
                  <textarea id="sourceText" name="sourceText" class="tall" required minlength="80" maxlength="6000">${f.sourceText}</textarea>
                  <div class="hint">Dán phần nội dung của bài nguồn (tối thiểu 80 ký tự). Hệ thống không tự tải trang; chỉ dùng đúng phần bạn dán.</div></div>
                <div class="field full"><label for="note">Ghi chú cho biên tập (tùy chọn)</label>
                  <textarea id="note" name="note" maxlength="500">${f.note}</textarea></div>
                <div class="full savebar"><button class="btn primary" type="submit">Tạo bài và gửi vào hàng chờ</button></div>
              </form>`}
        </div></section>
        <aside>
          <section class="panel"><div class="panel-h">Quy tắc</div><div class="panel-b">
            <ol class="rules">
              <li>Bài luôn có nguồn. Nguồn phải thuộc tên miền được phép.</li>
              <li>Hệ thống chỉ dùng nội dung bạn dán, không tự truy cập trang.</li>
              <li>Mọi khẳng định cần kiểm được liệt kê để người duyệt đối chiếu.</li>
              <li>Bài không tự đăng: phải qua duyệt và hẹn giờ như bình thường.</li>
            </ol>
          </div></section>
        </aside>
      </div>
    </div>`,
  );
}
