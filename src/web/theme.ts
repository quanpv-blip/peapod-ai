// Chuyển chế độ sáng/tối. Chạy trước khi vẽ trang để tránh nháy. Lựa chọn lưu trên trình duyệt của từng người.
// Không dùng mã nội tuyến: file này được phục vụ từ /assets/theme.js để CSP (script-src 'self') vẫn chặn mọi script lạ.
export const THEME_JS = `(function () {
  var KEY = 'pp-theme';
  var root = document.documentElement;
  function read() {
    try { return localStorage.getItem(KEY) || 'system'; } catch (e) { return 'system'; }
  }
  function apply(mode) {
    if (mode === 'light' || mode === 'dark') root.setAttribute('data-theme', mode);
    else root.removeAttribute('data-theme');
  }
  function mark(mode) {
    var buttons = document.querySelectorAll('[data-set-theme]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-set-theme') === mode));
    }
  }
  apply(read());
  document.addEventListener('DOMContentLoaded', function () { mark(read()); });
  document.addEventListener('click', function (ev) {
    var target = ev.target;
    var btn = target && target.closest ? target.closest('[data-set-theme]') : null;
    if (!btn) return;
    var mode = btn.getAttribute('data-set-theme');
    try { localStorage.setItem(KEY, mode); } catch (e) { /* trình duyệt chặn lưu trữ: vẫn đổi cho phiên này */ }
    apply(mode);
    mark(mode);
  });
})();`;
