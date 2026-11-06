// Script nhỏ cho module video Reels, phục vụ tại /assets/reel.js (CSP chỉ cho script từ chính máy chủ).
// Làm hai việc: (1) cập nhật thanh tiến độ tại chỗ (trang bài và từng dòng trang Video), chỉ tải lại trang MỘT lần khi xong;
// (2) khóa nút ngay khi bấm để không gửi nhiều lần. (data-reel-refresh: tải lại theo nhịp, không còn trang nào dùng.)
export const REEL_JS = `(function () {
  'use strict';
  var POLL_MS = 1500;
  var REFRESH_MS = 4000;

  function q(sel, root) { return (root || document).querySelector(sel); }
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }

  // Tải lại trang nhưng bỏ tham số ok (thông báo một lần) để không hiện lại.
  function reloadClean() {
    var u = new URL(window.location.href);
    u.searchParams.delete('ok');
    window.location.replace(u.toString());
  }

  function applyStatus(box, s) {
    var bar = q('[data-reel-bar]', box);
    if (bar) bar.value = s.pct;
    setText(q('[data-reel-pct]', box), s.pct + '%');
    setText(q('[data-reel-stage]', box), s.stageText);
    setText(q('[data-reel-eta]', box), s.etaText);
  }

  function pollBox(box) {
    var url = box.getAttribute('data-reel-poll');
    var msg = q('[data-reel-msg]', box);
    var timer = setInterval(function () {
      fetch(url, { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          return r.json();
        })
        .then(function (s) {
          setText(msg, '');
          if (s.state !== 'pending') {
            clearInterval(timer);
            reloadClean();
            return;
          }
          applyStatus(box, s);
        })
        .catch(function () {
          setText(msg, 'Mất kết nối tới máy chủ, đang thử lại…');
        });
    }, POLL_MS);
  }

  var boxes = document.querySelectorAll('[data-reel-poll]');
  for (var i = 0; i < boxes.length; i++) pollBox(boxes[i]);

  if (q('[data-reel-refresh]')) {
    setTimeout(reloadClean, REFRESH_MS);
  }

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || !f.hasAttribute) return;
    if (f.hasAttribute('data-reel-form')) {
      if (f.getAttribute('data-busy') === '1') {
        e.preventDefault();
        return;
      }
      f.setAttribute('data-busy', '1');
      var b = f.querySelector('button');
      if (b) {
        b.disabled = true;
        b.textContent = 'Đang gửi…';
      }
    }
    if (f.hasAttribute('data-reel-cancel')) {
      var c = f.querySelector('button');
      if (c) {
        c.disabled = true;
        c.textContent = 'Đang hủy…';
      }
    }
  });
})();
`;
