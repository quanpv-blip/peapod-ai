// Script giao diện chung, phục vụ tại /assets/ui.js (CSP chỉ cho script từ chính máy chủ).
// (1) Hàng chờ: chọn tất cả, đếm số bài đã chọn, khóa nút khi gửi; (2) theo dõi tiến độ việc "Tạo bản tin" và tải lại khi xong.
export const UI_JS = `(function () {
  'use strict';
  function q(sel, root) { return (root || document).querySelector(sel); }
  function all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }

  // --- chọn hàng loạt ---
  var form = q('form[data-bulk-form]');
  if (form) {
    var boxes = function () { return all('input[name="ids"]', form); };
    var master = q('[data-bulk-all]', form);
    var count = q('[data-bulk-count]', form);
    var sync = function () {
      var on = boxes().filter(function (b) { return b.checked; }).length;
      setText(count, on ? 'Đã chọn ' + on + ' bài' : 'Chưa chọn bài nào');
      all('[data-bulk-act]', form).forEach(function (b) { b.disabled = on === 0; });
      if (master) master.checked = on > 0 && on === boxes().length;
    };
    if (master) master.addEventListener('change', function () { boxes().forEach(function (b) { b.checked = master.checked; }); sync(); });
    form.addEventListener('change', function (e) { if (e.target && e.target.name === 'ids') sync(); });
    var picks = q('[data-bulk-pick-ok]', form);
    if (picks) picks.addEventListener('click', function () {
      boxes().forEach(function (b) { b.checked = b.getAttribute('data-ok') === '1'; });
      sync();
    });
    form.addEventListener('submit', function (e) {
      if (form.getAttribute('data-busy') === '1') { e.preventDefault(); return; }
      form.setAttribute('data-busy', '1');
      all('button', form).forEach(function (b) { b.disabled = true; });
    });
    sync();
  }

  // --- tiến độ tạo bản tin ---
  var box = q('[data-gen-poll]');
  if (box) {
    var url = box.getAttribute('data-gen-poll');
    var running = box.getAttribute('data-gen-running') === '1';
    if (running) {
      var timer = setInterval(function () {
        fetch(url, { credentials: 'same-origin', cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
          .then(function (jobs) {
            var j = jobs && jobs[0];
            if (!j) return;
            if (j.state !== 'running') {
              clearInterval(timer);
              var u = new URL(window.location.href);
              u.searchParams.delete('ok');
              window.location.replace(u.toString());
              return;
            }
            var bar = q('[data-gen-bar]', box);
            if (bar) bar.value = j.pct;
            setText(q('[data-gen-text]', box), j.text);
            setText(q('[data-gen-time]', box), 'đã chạy ' + j.elapsedSec + ' giây');
          })
          .catch(function () { setText(q('[data-gen-time]', box), 'mất kết nối, đang thử lại…'); });
      }, 2000);
    }
  }
})();
`;
