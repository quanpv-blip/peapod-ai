import { APP_VERSION, flashBox, page, themeToggle, type Flash } from '../layout.ts';
import { html } from '../html.ts';

export function loginView(opts: { flash?: Flash; email?: string }): string {
  return page(
    { title: 'Đăng nhập' },
    html`<div class="auth">
      <aside class="auth-art">
        <div class="orb o1" aria-hidden="true"></div>
        <div class="orb o2" aria-hidden="true"></div>
        <div class="auth-brand-lg"><img class="logo" src="/assets/logo.svg" alt="" width="40" height="40"><span>PeaPod<b> AI</b></span></div>
        <div class="auth-copy">
          <h2>Duyệt nhanh. Đăng đúng giờ. Luôn có nguồn.</h2>
          <p>Hệ thống tự thu tin, soạn bài có dẫn nguồn và xếp lịch đăng. Người duyệt là người quyết định cuối cùng.</p>
          <ul class="auth-points">
            <li><span class="ck">✓</span>Mọi bài có nguồn dẫn và danh sách khẳng định cần kiểm tra</li>
            <li><span class="ck">✓</span>Bốn mắt cho thị trường Nhật Bản trước khi đăng</li>
            <li><span class="ck">✓</span>Nhật ký kiểm toán chỉ ghi thêm, không sửa được</li>
          </ul>
        </div>
        <div class="auth-art-foot">PeaPod AI · phiên bản ${APP_VERSION}</div>
      </aside>
      <section class="auth-form">
        ${themeToggle}
        <main class="auth-card">
          <h1>Chào mừng trở lại</h1>
          <p class="sub">Đăng nhập bằng tài khoản được cấp để vào giao diện duyệt.</p>
          ${flashBox(opts.flash)}
          <form method="post" action="/login">
            <div class="field"><label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required autofocus value="${opts.email ?? ''}"></div>
            <div class="field"><label for="password">Mật khẩu</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
            <button class="btn primary lg block" type="submit">Đăng nhập</button>
          </form>
          <p class="auth-help">Quên mật khẩu? Liên hệ quản trị viên để được đặt lại.</p>
        </main>
        <footer class="auth-foot">Nội bộ · chỉ dành cho người được cấp quyền</footer>
      </section>
    </div>`,
  );
}
