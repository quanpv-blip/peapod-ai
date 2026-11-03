import type { UserRow } from '../../services/users.ts';
import { empty, html, type Safe } from '../html.ts';
import { flashBox, page, type Flash, type PageCtx } from '../layout.ts';
import { when } from '../components.ts';

const ROLE_OPTIONS: [string, string][] = [
  ['approver_vn', 'Duyệt VN'],
  ['approver_jp', 'Duyệt JP'],
  ['admin', 'Quản trị'],
  ['viewer', 'Chỉ xem'],
];

export interface UsersOpts {
  flash?: Flash;
  /** Mật khẩu vừa tạo hoặc đặt lại: chỉ hiện trong lần render này, không lưu. */
  password?: { email: string; value: string };
  self: string;
}

export function usersView(ctx: Omit<PageCtx, 'title' | 'nav'>, users: UserRow[], o: UsersOpts): string {
  const hidden = html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;

  const secret: Safe = o.password
    ? html`<div class="secret" role="status"><b>Mật khẩu của ${o.password.email}</b> (chỉ hiện lần này, hãy gửi cho người dùng qua kênh an toàn):<br><code>${o.password.value}</code></div>`
    : empty;

  const rows: Safe = html`<div class="table-wrap"><table>
    <thead><tr><th>Tên</th><th>Email</th><th>Vai trò</th><th>Trạng thái</th><th>Tạo lúc</th><th></th></tr></thead>
    <tbody>${users.map((u) => html`<tr>
      <td>${u.display_name}</td>
      <td class="mono">${u.email}</td>
      <td>${u.roles.map((r) => ROLE_OPTIONS.find(([k]) => k === r)?.[1] ?? r).join(', ')}</td>
      <td>${u.disabled ? html`<span class="status bad">Đã khóa</span>` : html`<span class="status ok">Hoạt động</span>`}</td>
      <td class="muted">${when(u.created_at, 'VN')}</td>
      <td><div class="tbl-act">
        <form method="post" action="/users/${encodeURIComponent(u.email)}/reset">${hidden}<button class="btn sm" type="submit">Đặt lại mật khẩu</button></form>
        ${u.email === o.self ? empty : u.disabled
          ? html`<form method="post" action="/users/${encodeURIComponent(u.email)}/toggle">${hidden}<input type="hidden" name="action" value="enable"><button class="btn sm" type="submit">Mở khóa</button></form>`
          : html`<form method="post" action="/users/${encodeURIComponent(u.email)}/toggle">${hidden}<input type="hidden" name="action" value="disable"><button class="btn sm danger" type="submit">Khóa</button></form>`}
      </div></td>
    </tr>`)}</tbody></table></div>`;

  const create = html`<div class="panel"><div class="panel-h">Thêm người dùng</div><div class="panel-b">
    <form method="post" action="/users">${hidden}
      <div class="field"><label for="u-name">Tên hiển thị</label><input id="u-name" name="name" type="text" required maxlength="80"></div>
      <div class="field"><label for="u-email">Email</label><input id="u-email" name="email" type="email" required></div>
      <div class="field"><label>Vai trò</label>
        ${ROLE_OPTIONS.map(([k, label]) => html`<label class="check"><input type="checkbox" name="roles" value="${k}"${k === 'approver_vn' ? ' checked' : ''}> ${label}</label>`)}
        <div class="hint">Người duyệt JP cần ít nhất hai người (bốn mắt). Quản trị không duyệt thay (D-15).</div>
      </div>
      <button class="btn primary" type="submit">Tạo tài khoản</button>
    </form>
  </div></div>`;

  return page(
    { ...ctx, title: 'Người dùng', nav: 'users' },
    html`<div class="page">
      <div class="page-head"><div><h1>Người dùng</h1><div class="sub">Tài khoản đăng nhập giao diện duyệt. Đăng nhập SSO sẽ thay thế mật khẩu khi có.</div></div></div>
      ${flashBox(o.flash)}
      ${secret}
      <div class="cols" style="grid-template-columns:minmax(0,1fr) 340px">
        <div>${rows}</div>
        <aside>${create}</aside>
      </div>
    </div>`,
  );
}
