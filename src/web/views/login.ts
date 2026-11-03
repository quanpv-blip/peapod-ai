import { flashBox, page, type Flash } from '../layout.ts';
import { html } from '../html.ts';

export function loginView(opts: { flash?: Flash; email?: string }): string {
  return page(
    { title: 'Đăng nhập' },
    html`<main class="login">
      <h1>PeaPod AI</h1>
      <p class="sub">Đăng nhập để duyệt nội dung.</p>
      ${flashBox(opts.flash)}
      <form method="post" action="/login">
        <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required autofocus value="${opts.email ?? ''}"></div>
        <div class="field"><label for="password">Mật khẩu</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <button class="btn primary" type="submit">Đăng nhập</button>
      </form>
    </main>`,
  );
}
