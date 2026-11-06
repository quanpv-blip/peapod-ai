import { ACTION, actorLabel, marketTag, pager, when } from '../components.ts';
import { html } from '../html.ts';
import { page as layout, type PageCtx } from '../layout.ts';
import type { Market } from '../../domain/package.ts';
import type { Page } from '../../domain/paging.ts';

export interface AuditRow {
  id: number;
  content_id: number;
  revision: number;
  action: string;
  actor: string;
  note: string | null;
  created_at: Date;
  market: Market;
}

export function auditView(ctx: Omit<PageCtx, 'title' | 'nav'>, rows: AuditRow[], pg: Page): string {
  const body = rows.length
    ? html`<div class="table-wrap"><table>
        <thead><tr><th>Thời điểm</th><th>Người thực hiện</th><th>Thao tác</th><th>Bài</th><th>Bản</th><th>Ghi chú</th></tr></thead>
        <tbody>${rows.map(
          (r) => html`<tr>
            <td>${when(r.created_at, r.market)}</td>
            <td>${actorLabel(r.actor)}</td>
            <td>${ACTION[r.action] ?? r.action}</td>
            <td><a href="/contents/${r.content_id}">#${r.content_id}</a> ${marketTag(r.market)}</td>
            <td class="mono">v${r.revision}</td>
            <td class="muted">${r.note ?? ''}</td>
          </tr>`,
        )}</tbody></table></div>`
    : html`<div class="table-wrap"><div class="empty">Chưa có thao tác nào.</div></div>`;
  return layout(
    { ...ctx, title: 'Nhật ký kiểm toán', nav: 'audit' },
    html`<div class="page">
      <div class="page-head"><div><h1>Nhật ký kiểm toán</h1><div class="sub">Chỉ ghi thêm, không sửa hoặc xóa. Tối đa 1.000 dòng gần nhất khi xuất.</div></div><a class="btn" href="/audit.csv">Tải CSV</a></div>
      ${body}
      ${pager(pg, (n) => `/audit?page=${n}`)}
    </div>`,
  );
}
