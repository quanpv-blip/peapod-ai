import { MIN_PASSWORD } from '../../services/account.ts';
import { html } from '../html.ts';
import { flashBox, page, type Flash, type PageCtx } from '../layout.ts';

export function accountPage(ctx: Omit<PageCtx, 'title' | 'nav'>, o: { flash?: Flash } = {}): string {
  const hidden = html`<input type="hidden" name="_csrf" value="${ctx.csrf}">`;
  return page(
    { ...ctx, title: 'Tài khoản', nav: 'account' },
    html`<div class="page">
      <div class="page-head"><div><div class="crumb">Tài khoản</div><h1>Tài khoản của tôi</h1><div class="sub">${ctx.user?.name} · ${ctx.user?.email}</div></div></div>
      ${flashBox(o.flash)}
      <div class="cols">
        <section class="panel"><div class="panel-h">Đổi mật khẩu</div><div class="panel-b">
          <form method="post" action="/account/password" class="form-grid">${hidden}
            <div class="field full"><label for="current">Mật khẩu hiện tại</label><input id="current" name="current" type="password" required autocomplete="current-password"></div>
            <div class="field"><label for="next">Mật khẩu mới</label><input id="next" name="next" type="password" required minlength="${MIN_PASSWORD}" autocomplete="new-password"><div class="hint">Ít nhất ${MIN_PASSWORD} ký tự.</div></div>
            <div class="field"><label for="confirm">Nhập lại mật khẩu mới</label><input id="confirm" name="confirm" type="password" required minlength="${MIN_PASSWORD}" autocomplete="new-password"></div>
            <div class="full savebar"><button class="btn primary" type="submit">Đổi mật khẩu</button></div>
          </form>
        </div></section>
        <aside>
          <section class="panel"><div class="panel-h">Lưu ý</div><div class="panel-b">
            <p class="small">Đăng nhập bằng SSO sẽ thay thế mật khẩu khi triển khai. Khi đó trang này không còn cần thiết.</p>
            <p class="small muted">Quản trị viên có thể đặt lại mật khẩu cho bạn ở trang Người dùng.</p>
          </div></section>
        </aside>
      </div>
    </div>`,
  );
}
