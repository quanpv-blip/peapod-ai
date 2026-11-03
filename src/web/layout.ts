import { createHash } from 'node:crypto';
import { empty, esc, html, raw, type Safe } from './html.ts';
import { CSS } from './styles.ts';

// Mã băm nội dung CSS: đổi CSS thì đường dẫn đổi theo, trình duyệt không dùng bản cũ đang cache.
export const CSS_VERSION = createHash('sha256').update(CSS).digest('hex').slice(0, 10);

export interface Flash {
  kind: 'ok' | 'err' | 'warn';
  text: string;
}

export type NavKey = 'dash' | 'queue' | 'schedule' | 'campaign' | 'quota' | 'audit' | 'users' | 'costs' | 'settings' | 'account';

export interface PageCtx {
  title: string;
  user?: { name: string; email: string; roles: string[] };
  csrf?: string;
  nav?: NavKey;
  /** Số bài đang chờ duyệt: huy hiệu ở mục Hàng chờ và chuông thông báo. */
  pending?: number;
  /** Công tắc tạm dừng đang bật: banner trên mọi trang. */
  paused?: boolean;
}

export const APP_VERSION = '2.6';

const ROLE_LABEL: Record<string, string> = { approver_vn: 'Duyệt VN', approver_jp: 'Duyệt JP', admin: 'Quản trị', viewer: 'Chỉ xem' };

// Biểu tượng nét mảnh, một bộ thống nhất (stroke 1.6). Dữ liệu tĩnh do mã này viết, không có đầu vào người dùng.
const PATH: Record<string, string> = {
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  queue: '<path d="M4 6h16M4 12h11M4 18h7"/><path d="m16 16 2 2 4-4"/>',
  schedule: '<rect x="3" y="4.5" width="18" height="16" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
  campaign: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="5"/>',
  audit: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  costs: '<path d="M4 20h16"/><path d="M7 16V11M12 16V7M17 16v-3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  account: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.7-4 4-6 8-6s7.3 2 8 6"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 14.8c1.4.9 2.2 2.6 2.5 5.2"/>',
  quota: '<path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 2"/><path d="M19 3v4h-4"/>',
  bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  logout: '<path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  auto: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
};
const svg = (name: string, cls = 'ico') =>
  raw(`<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATH[name] ?? ''}</svg>`);

export const flashBox = (f?: Flash): Safe => (f ? html`<div class="notice ${f.kind}" role="${f.kind === 'err' ? 'alert' : 'status'}">${f.text}</div>` : empty);

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]!.toUpperCase()).join('') || '?';

const themeSwitch = html`<div class="theme" role="group" aria-label="Chế độ hiển thị">
  <button type="button" data-set-theme="light" aria-pressed="false" title="Giao diện sáng">${svg('sun')}<span class="lbl">Sáng</span></button>
  <button type="button" data-set-theme="dark" aria-pressed="false" title="Giao diện tối">${svg('moon')}<span class="lbl">Tối</span></button>
  <button type="button" data-set-theme="system" aria-pressed="true" title="Theo cài đặt của máy">${svg('auto')}<span class="lbl">Tự động</span></button>
</div>`;

const footer = html`<footer class="footer">
  <span><b>PeaPod AI</b> · phiên bản ${APP_VERSION}</span><span class="sep-dot" aria-hidden="true"></span>
  <span>Nội bộ · chỉ dành cho người được cấp quyền</span>
  <span class="grow"></span>
  <a class="live" href="/">Trạng thái hệ thống</a>
  <a href="/audit">Nhật ký kiểm toán</a>
</footer>`;

export function page(ctx: PageCtx, body: Safe): string {
  const admin = !!ctx.user && ctx.user.roles.includes('admin');
  const item = (k: NavKey, href: string, label: string, badge?: number) =>
    html`<a href="${href}" class="nav-i ${ctx.nav === k ? 'on' : ''}"${ctx.nav === k ? ' aria-current="page"' : ''}>${svg(k)}<span>${label}</span>${badge ? html`<span class="badge" aria-label="${badge} bài chờ duyệt">${badge}</span>` : empty}</a>`;

  const shell = ctx.user
    ? html`<div class="shell">
        <aside class="side" aria-label="Điều hướng chính">
          <a class="brand" href="/"><img class="logo" src="/assets/logo.svg" alt="" width="36" height="36"><span class="brand-t">PeaPod<b> AI</b></span></a>
          <nav class="nav">
            <div class="nav-g">Công việc</div>
            ${item('dash', '/', 'Tổng quan')}
            ${item('queue', '/queue', 'Hàng chờ duyệt', ctx.pending)}
            ${item('campaign', '/create', 'Tạo bài viết mới')}
            ${item('quota', '/quota', 'Hạn mức & credit')}
            ${item('schedule', '/schedule', 'Lịch đăng')}
            ${admin ? html`<div class="nav-g">Quản trị</div>${item('costs', '/costs', 'Chi phí AI')}${item('settings', '/settings', 'Cài đặt')}${item('users', '/users', 'Người dùng')}${item('audit', '/audit', 'Nhật ký kiểm toán')}` : html`<div class="nav-g">Hồ sơ</div>${item('audit', '/audit', 'Nhật ký kiểm toán')}`}
          </nav>
          <div class="side-f">
            <div class="avatar" aria-hidden="true">${initials(ctx.user.name)}</div>
            <a class="who" href="/account" title="Tài khoản của tôi"><div class="who-n">${ctx.user.name}</div><div class="who-r">${ctx.user.roles.map((r) => ROLE_LABEL[r] ?? r).join(' · ')}</div></a>
          </div>
        </aside>
        <div class="content">
          <header class="topbar">
            <div class="topbar-title small muted" aria-hidden="true">${ctx.title}</div>
            <div class="grow"></div>
            ${themeSwitch}
            <a class="iconbtn" href="/queue" title="Hàng chờ duyệt" aria-label="Hàng chờ duyệt${ctx.pending ? `, ${ctx.pending} bài` : ''}">${svg('bell')}${ctx.pending ? html`<span class="dot"></span>` : empty}</a>
            <details class="usermenu">
              <summary aria-label="Menu người dùng"><span class="avatar">${initials(ctx.user.name)}</span><span class="nm">${ctx.user.name}</span></summary>
              <div class="menu" role="menu">
                <a href="/account" role="menuitem">${svg('account')}Tài khoản của tôi</a>
                <a href="/audit" role="menuitem">${svg('audit')}Nhật ký kiểm toán</a>
                <hr>
                <form method="post" action="/logout" style="margin:0">
                  <input type="hidden" name="_csrf" value="${ctx.csrf}">
                  <button type="submit" role="menuitem">${svg('logout')}Đăng xuất</button>
                </form>
              </div>
            </details>
          </header>
          ${ctx.paused ? html`<div class="banner" role="alert"><b>Công tắc tạm dừng đang BẬT.</b> Không hẹn bài mới lên Trang và không sinh bài mới. Hủy bài và đối soát vẫn chạy.</div>` : empty}
          <main class="page">${body}</main>
          ${footer}
        </div>
      </div>`
    : body;

  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${esc(ctx.title)} · PeaPod AI</title>
<link rel="icon" type="image/svg+xml" href="/assets/logo.svg"><link rel="stylesheet" href="/assets/app.css?v=${CSS_VERSION}"><script src="/assets/theme.js"></script></head>
<body>${shell.html}</body></html>`;
}

/** Nút chuyển chế độ dùng lại ở trang đăng nhập. */
export const themeToggle = themeSwitch;
