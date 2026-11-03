import { APP_VERSION, flashBox, page, themeToggle, type Flash } from '../layout.ts';
import { html } from '../html.ts';

export function loginView(opts: { flash?: Flash; email?: string }): string {
  return page(
    { title: 'Đăng nhập' },
    html`<div class="auth">
      ${themeToggle}
      <main class="auth-card">
        <div class="auth-brand">
          <img class="logo" src="/assets/logo.svg" alt="" width="44" height="44">
          <div><div class="auth-name">PeaPod<b> AI</b></div><div class="auth-tag">Duyệt và đăng nội dung có nguồn</div></div>
        </div>
        <h1>Đăng nhập</h1>
        <p class="sub">Dùng tài khoản được cấp để vào giao diện duyệt.</p>
        ${flashBox(opts.flash)}
        <form method="post" action="/login">
          <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required autofocus value="${opts.email ?? ''}"></div>
          <div class="field"><label for="password">Mật khẩu</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
          <button class="btn primary lg block" type="submit">Đăng nhập</button>
        </form>
        <p class="auth-help">Quên mật khẩu? Liên hệ quản trị viên để được đặt lại.</p>
      </main>
      <footer class="auth-foot">PeaPod AI · phiên bản ${APP_VERSION} · Nội bộ, chỉ dành cho người được cấp quyền</footer>
    </div>`,
  );
}
