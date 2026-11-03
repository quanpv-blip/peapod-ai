import { APP_VERSION, flashBox, page, themeToggle, type Flash } from '../layout.ts';
import { html } from '../html.ts';

export function loginView(opts: { flash?: Flash; email?: string }): string {
  return page(
    { title: 'Đăng nhập' },
    html`<div class="auth">
      <aside class="auth-art">
        <a class="brand" href="/"><img class="logo" src="/assets/logo.svg" alt="" width="36" height="36"><span class="brand-t">PeaPod<b> AI</b></span></a>
        <div>
          <h2>Duyệt nội dung nhanh, có nguồn, đúng thương hiệu.</h2>
          <p>Hệ thống tự thu thập tin, soạn bài có nguồn và xếp lịch đăng. Người duyệt là người quyết định cuối cùng.</p>
          <ul>
            <li>Mọi bài có nguồn dẫn và danh sách khẳng định cần kiểm tra</li>
            <li>Bốn mắt cho thị trường Nhật Bản</li>
            <li>Nhật ký kiểm toán chỉ ghi thêm, không sửa được</li>
          </ul>
        </div>
        <span class="small" style="opacity:.8">PeaPod AI · phiên bản ${APP_VERSION}</span>
      </aside>
      <section class="auth-form">
        ${themeToggle}
        <div class="login">
          <h1>Đăng nhập</h1>
          <p class="sub">Dùng tài khoản được cấp để vào giao diện duyệt.</p>
          ${flashBox(opts.flash)}
          <form method="post" action="/login">
            <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required autofocus value="${opts.email ?? ''}"></div>
            <div class="field"><label for="password">Mật khẩu</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
            <button class="btn primary lg block" type="submit">Đăng nhập</button>
          </form>
          <p class="hint" style="margin-top:20px">Quên mật khẩu? Liên hệ quản trị viên để được đặt lại.</p>
        </div>
      </section>
    </div>`,
  );
}
