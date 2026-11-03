import type { Market } from '../../domain/package.ts';
import type { SourceItem } from '../../services/sources.ts';
import type { SuggestResult } from '../../services/topics.ts';
import { empty, html, type Safe } from '../html.ts';
import { flashBox, page, type Flash, type PageCtx } from '../layout.ts';
import { when } from '../components.ts';

export interface CreateOpts {
  markets: Market[];
  market: Market;
  recent: SourceItem[];
  suggest?: SuggestResult;
  aiOn: boolean;
  flash?: Flash;
  topic?: string;
}

const SOURCE_LABEL: Record<SuggestResult['source'], string> = {
  ai: 'Mô hình AI đề xuất từ các tin mới',
  'tin-mới': 'Danh sách tin mới nhất (không dùng AI)',
  trống: 'Chưa có tin nào trong 3 ngày gần đây',
};

export function createPage(ctx: Omit<PageCtx, 'title' | 'nav'>, o: CreateOpts): string {
  const hidden = html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
  const marketSelect = html`<select name="market" aria-label="Thị trường">${o.markets.map((m) => html`<option value="${m}"${m === o.market ? ' selected' : ''}>${m}</option>`)}</select>`;
  const blocked = !o.aiOn || o.markets.length === 0;

  const suggestions: Safe = o.suggest
    ? html`<section class="panel"><div class="panel-h"><div>Chủ đề đề xuất <span class="small muted" style="font-weight:400">· ${SOURCE_LABEL[o.suggest.source]}</span></div></div>
        <div class="panel-b">
          ${o.suggest.topics.length
            ? html`<div class="topics">${o.suggest.topics.map((t) => html`<article class="topic">
                  <h3>${t.title}</h3>
                  <p class="small muted">${t.reason}</p>
                  <ul class="small topic-src">${t.urls.map((u) => html`<li><a href="${u}" target="_blank" rel="noopener noreferrer">${sourceTitle(o.suggest!, u)}</a></li>`)}</ul>
                  <form method="post" action="/create/generate">${hidden}<input type="hidden" name="market" value="${o.market}"><input type="hidden" name="topic" value="${t.title}">
                    ${t.urls.map((u) => html`<input type="hidden" name="urls" value="${u}">`)}
                    <button class="btn primary" type="submit"${blocked ? ' disabled' : ''}>Tạo bài từ chủ đề này</button>
                  </form>
                </article>`)}</div>`
            : html`<div class="empty">Chưa có tin nào để đề xuất. Kho tin làm mới mỗi 30 phút; thử lại sau hoặc kiểm tra nguồn RSS trong Cài đặt.</div>`}
        </div></section>`
    : empty;

  const recent: Safe = html`<section class="panel"><div class="panel-h"><div>Tin trong kho <span class="small muted" style="font-weight:400">· ${o.market}, 3 ngày gần đây</span></div></div>
    <div class="panel-b">
      ${o.recent.length
        ? html`<ul class="list">${o.recent.slice(0, 15).map((i) => html`<li><div class="when">${i.published_at ? when(i.published_at, o.market) : '-'}</div>
            <div class="what"><a href="${i.url}" target="_blank" rel="noopener noreferrer">${i.title}</a><span class="muted small">${i.feed}</span></div></li>`)}</ul>`
        : html`<div class="empty">Chưa có tin trong kho.</div>`}
    </div></section>`;

  return page(
    { ...ctx, title: 'Tạo bài viết mới', nav: 'campaign' },
    html`<div class="page">
      <div class="page-head"><div><div class="crumb">Công việc</div><h1>Tạo bài viết mới</h1><div class="sub">Chọn thị trường, để hệ thống đề xuất chủ đề từ các tin mới, rồi chọn một chủ đề. Hệ thống tìm tin liên quan và viết bài; bài vào hàng chờ duyệt.</div></div></div>
      ${flashBox(o.flash)}
      ${blocked ? html`<div class="notice warn">${!o.aiOn ? 'Chưa cấu hình khóa Gemini (GEMINI_API_KEY) nên chưa viết được bài.' : 'Tài khoản chưa có quyền duyệt thị trường nào.'}</div>` : empty}
      <div class="cols">
        <div>
          <section class="panel"><div class="panel-h"><div>Bước 1 · Đề xuất chủ đề</div></div><div class="panel-b">
            <form method="post" action="/create/suggest" class="toolbar-form">${hidden}
              <label class="inline-label">Thị trường ${marketSelect}</label>
              <button class="btn primary" type="submit"${o.markets.length === 0 ? ' disabled' : ''}>Đề xuất chủ đề</button>
            </form>
          </div></section>
          ${suggestions}
          <section class="panel"><div class="panel-h"><div>Bước 2 · Hoặc tự nhập chủ đề</div></div><div class="panel-b">
            <form method="post" action="/create/generate" class="form-grid">${hidden}
              <div class="field"><label for="m2">Thị trường</label><select id="m2" name="market">${o.markets.map((m) => html`<option value="${m}"${m === o.market ? ' selected' : ''}>${m}</option>`)}</select></div>
              <div class="field"><label for="topic">Chủ đề</label><input id="topic" name="topic" type="text" required maxlength="60" value="${o.topic ?? ''}" placeholder="Ví dụ: chip bán dẫn Việt Nam"><div class="hint">Hệ thống tìm tin liên quan đến các từ khóa trong chủ đề trong kho 14 ngày gần đây.</div></div>
              <div class="full savebar"><button class="btn primary" type="submit"${blocked ? ' disabled' : ''}>Tìm tin và tạo bài</button></div>
            </form>
          </div></section>
        </div>
        <aside>${recent}</aside>
      </div>
    </div>`,
  );
}

function sourceTitle(s: SuggestResult, url: string): string {
  return s.items.find((i) => i.url === url)?.title ?? url;
}
