import { empty, esc, html, raw, type Safe } from './html.ts';

export interface Flash {
  kind: 'ok' | 'err' | 'warn';
  text: string;
}

export type NavKey = 'dash' | 'queue' | 'schedule' | 'audit' | 'users';

export interface PageCtx {
  title: string;
  user?: { name: string; email: string; roles: string[] };
  csrf?: string;
  nav?: NavKey;
  /** Số bài đang chờ duyệt, hiện ở huy hiệu trên thanh bên. */
  pending?: number;
  /** Công tắc tạm dừng đang bật: hiện banner trên mọi trang để không ai quên. */
  paused?: boolean;
}

const ROLE_LABEL: Record<string, string> = { approver_vn: 'Duyệt VN', approver_jp: 'Duyệt JP', admin: 'Quản trị', viewer: 'Chỉ xem' };

// Biểu tượng nét mảnh, dùng chung một hệ (stroke 1.6). Dữ liệu tĩnh do mã này viết, không có đầu vào người dùng.
const ICON: Record<NavKey, string> = {
  dash: '<path d="M3 3h7v8H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 15h7v6H3z"/>',
  queue: '<path d="M4 6h16M4 12h16M4 18h10"/><path d="m17 16 2 2 3-4"/>',
  schedule: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
  audit: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.4.9 2.2 2.6 2.5 5.2"/>',
};
const svg = (k: NavKey) => raw(`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`);

export const flashBox = (f?: Flash): Safe => (f ? html`<div class="notice ${f.kind}" role="${f.kind === 'err' ? 'alert' : 'status'}">${f.text}</div>` : empty);

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]!.toUpperCase()).join('') || '?';

export function page(ctx: PageCtx, body: Safe): string {
  const item = (k: NavKey, href: string, label: string, badge?: number) =>
    html`<a href="${href}" class="nav-i ${ctx.nav === k ? 'on' : ''}">${svg(k)}<span>${label}</span>${badge ? html`<span class="badge">${badge}</span>` : empty}</a>`;

  const shell = ctx.user
    ? html`<div class="shell">
        <aside class="side">
          <a class="brand" href="/"><span class="logo">P</span><span class="brand-t">PeaPod<b> AI</b></span></a>
          <nav class="nav">
            <div class="nav-g">Công việc</div>
            ${item('dash', '/', 'Tổng quan')}
            ${item('queue', '/queue', 'Hàng chờ duyệt', ctx.pending)}
            ${item('schedule', '/schedule', 'Lịch đăng')}
            <div class="nav-g">Quản trị</div>
            ${ctx.user.roles.includes('admin') ? item('users', '/users', 'Người dùng') : empty}
            ${item('audit', '/audit', 'Nhật ký kiểm toán')}
          </nav>
          <div class="side-f">
            <div class="avatar">${initials(ctx.user.name)}</div>
            <div class="who"><div class="who-n">${ctx.user.name}</div><div class="who-r">${ctx.user.roles.map((r) => ROLE_LABEL[r] ?? r).join(' · ')}</div></div>
            <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${ctx.csrf}"><button class="out" type="submit" title="Đăng xuất" aria-label="Đăng xuất"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/></svg></button></form>
          </div>
        </aside>
        <main class="content">${ctx.paused ? html`<div class="banner" role="alert"><b>Công tắc tạm dừng đang BẬT.</b> Không hẹn bài mới lên Trang và không sinh bài mới. Hủy bài và đối soát vẫn chạy.</div>` : empty}${body}</main>
      </div>`
    : body;

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(ctx.title)} - PeaPod AI</title><link rel="stylesheet" href="/assets/app.css"></head>
<body>${shell.html}</body></html>`;
}
