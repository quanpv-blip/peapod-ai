// JavaScript cho chuyển động và thao tác nhanh. Phục vụ chung trong /assets/ui.js (CSP script-src 'self': không mã nội tuyến).
// Mọi tính năng ở đây chỉ là nâng cấp: trang vẫn dùng được khi script lỗi. Tôn trọng prefers-reduced-motion.
// Lưu ý: chuỗi này nằm trong template literal của TypeScript, nên không dùng dấu huyền và không dùng ký hiệu đô la kèm ngoặc nhọn.
export const MOTION_JS = `
(function () {
  'use strict';
  var root = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function q(sel, ctx) { return (ctx || document).querySelector(sel); }
  function all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function isTyping(el) { return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }
  var narrow = function () { return window.matchMedia('(max-width: 980px)').matches; };

  // --- thanh đầu: hiện đường kẻ khi cuộn ---
  var bar = q('.topbar');
  if (bar) {
    var onScroll = function () { bar.classList.toggle('is-scrolled', window.scrollY > 4); };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // --- thanh bên: thu gọn trên máy tính, ngăn kéo trên điện thoại ---
  if (store('pp-rail') === 'mini' && !narrow()) root.setAttribute('data-rail', 'mini');
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (t.closest('[data-rail-toggle]')) {
      if (narrow()) {
        if (root.getAttribute('data-nav') === 'open') root.removeAttribute('data-nav'); else root.setAttribute('data-nav', 'open');
      } else if (root.getAttribute('data-rail') === 'mini') {
        root.removeAttribute('data-rail'); store('pp-rail', 'full');
      } else {
        root.setAttribute('data-rail', 'mini'); store('pp-rail', 'mini');
      }
    } else if (t.closest('[data-nav-close]') || t.closest('.nav-i')) {
      root.removeAttribute('data-nav');
    }
  });

  // --- thông báo thành công thành toast tự tắt ---
  var toasts = q('#toasts');
  if (toasts) {
    all('[data-flash]').forEach(function (n, i) {
      n.removeAttribute('data-flash');
      n.classList.add('toast');
      toasts.appendChild(n);
      setTimeout(function () {
        n.classList.add('is-out');
        setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 320);
      }, 5200 + i * 600);
    });
  }

  // --- số đếm lên (chỉ khi số là số nguyên đứng đầu ô) ---
  if (!reduce) {
    all('.kpi-v, .hero-v').forEach(function (el) {
      var node = el.firstChild;
      if (!node || node.nodeType !== 3) return;
      var txt = node.nodeValue.trim();
      if (!/^\\d{1,6}$/.test(txt)) return;
      var target = parseInt(txt, 10);
      if (target < 2) return;
      var t0 = null;
      node.nodeValue = '0';
      var step = function (ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min(1, (ts - t0) / 800);
        var eased = 1 - Math.pow(1 - p, 3);
        node.nodeValue = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(step); else node.nodeValue = String(target);
      };
      requestAnimationFrame(step);
    });
  }

  // --- nút gửi biểu mẫu: hiện vòng quay trong lúc chờ ---
  document.addEventListener('submit', function (e) {
    var f = e.target;
    var b = e.submitter || (f && f.querySelector && f.querySelector('button[type=submit], button:not([type])'));
    if (!b || b.classList.contains('is-loading') || !b.classList.contains('btn')) return;
    setTimeout(function () { b.classList.add('is-loading'); }, 0);
    setTimeout(function () { b.classList.remove('is-loading'); }, 15000);
  });
  window.addEventListener('pageshow', function () { all('.btn.is-loading').forEach(function (b) { b.classList.remove('is-loading'); }); });

  // --- bảng lệnh nhanh: Ctrl/Cmd + K hoặc dấu / ---
  var palette = null, listEl = null, inputEl = null, items = [], shown = [], sel = 0;
  var plain = function (s) { return (s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase(); };
  function collect() {
    var out = [];
    all('.nav-i').forEach(function (a) {
      var span = a.querySelector('span');
      var icon = a.querySelector('svg');
      out.push({ label: span ? span.textContent.trim() : a.textContent.trim(), group: 'Đi tới', href: a.getAttribute('href'), icon: icon ? icon.outerHTML : '' });
    });
    out.push({ label: 'Chỉ xem bài đang chờ duyệt', group: 'Đi tới', href: '/queue?state=IN_REVIEW', icon: '' });
    out.push({ label: 'Tài khoản của tôi', group: 'Đi tới', href: '/account', icon: '' });
    out.push({ label: 'Giao diện sáng', group: 'Hiển thị', run: function () { var b = q('[data-set-theme="light"]'); if (b) b.click(); }, icon: '' });
    out.push({ label: 'Giao diện tối', group: 'Hiển thị', run: function () { var b = q('[data-set-theme="dark"]'); if (b) b.click(); }, icon: '' });
    out.push({ label: 'Giao diện theo máy', group: 'Hiển thị', run: function () { var b = q('[data-set-theme="system"]'); if (b) b.click(); }, icon: '' });
    return out;
  }
  function render() {
    var term = plain(inputEl.value.trim());
    shown = items.filter(function (it) { return !term || plain(it.label).indexOf(term) !== -1 || plain(it.group).indexOf(term) !== -1; });
    if (sel >= shown.length) sel = 0;
    listEl.textContent = '';
    if (!shown.length) { var em = document.createElement('div'); em.className = 'cmdk-empty'; em.textContent = 'Không có kết quả khớp.'; listEl.appendChild(em); return; }
    var lastGroup = null;
    shown.forEach(function (it, i) {
      if (it.group !== lastGroup) { var g = document.createElement('div'); g.className = 'cmdk-g'; g.textContent = it.group; listEl.appendChild(g); lastGroup = it.group; }
      var row = document.createElement('a');
      row.className = 'cmdk-i' + (i === sel ? ' is-sel' : '');
      row.href = it.href || '#';
      row.setAttribute('data-i', String(i));
      if (it.icon) { var s = document.createElement('span'); s.innerHTML = it.icon; row.appendChild(s.firstChild); }
      var lb = document.createElement('span'); lb.textContent = it.label; row.appendChild(lb);
      listEl.appendChild(row);
    });
    var cur = q('.is-sel', listEl); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }
  function choose(i) {
    var it = shown[i]; if (!it) return;
    closePalette();
    if (it.run) it.run(); else if (it.href) window.location.href = it.href;
  }
  function build() {
    palette = document.createElement('div'); palette.className = 'cmdk'; palette.setAttribute('role', 'dialog'); palette.setAttribute('aria-modal', 'true'); palette.setAttribute('aria-label', 'Tìm nhanh');
    var box = document.createElement('div'); box.className = 'cmdk-box';
    var inWrap = document.createElement('div'); inWrap.className = 'cmdk-in';
    inputEl = document.createElement('input'); inputEl.type = 'text'; inputEl.placeholder = 'Gõ để tìm trang hoặc thao tác…'; inputEl.setAttribute('aria-label', 'Tìm nhanh'); inputEl.autocomplete = 'off';
    inWrap.appendChild(inputEl);
    listEl = document.createElement('div'); listEl.className = 'cmdk-list';
    var foot = document.createElement('div'); foot.className = 'cmdk-foot'; foot.textContent = '↑ ↓ để chọn  ·  Enter để mở  ·  Esc để đóng';
    box.appendChild(inWrap); box.appendChild(listEl); box.appendChild(foot); palette.appendChild(box);
    document.body.appendChild(palette);
    palette.addEventListener('mousedown', function (e) { if (e.target === palette) closePalette(); });
    listEl.addEventListener('click', function (e) { var r = e.target.closest ? e.target.closest('.cmdk-i') : null; if (r) { e.preventDefault(); choose(parseInt(r.getAttribute('data-i'), 10)); } });
    listEl.addEventListener('mousemove', function (e) { var r = e.target.closest ? e.target.closest('.cmdk-i') : null; if (r) { var n = parseInt(r.getAttribute('data-i'), 10); if (n !== sel) { sel = n; all('.cmdk-i', listEl).forEach(function (x) { x.classList.toggle('is-sel', parseInt(x.getAttribute('data-i'), 10) === sel); }); } } });
    inputEl.addEventListener('input', function () { sel = 0; render(); });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    });
  }
  function openPalette() {
    if (!palette) build();
    items = collect(); sel = 0; inputEl.value = ''; render();
    palette.classList.add('is-open');
    setTimeout(function () { inputEl.focus(); }, 0);
  }
  function closePalette() { if (palette) palette.classList.remove('is-open'); }
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('[data-cmdk-open]')) openPalette(); });

  // --- phím tắt ---
  var focusRow = -1;
  function rows() { return all('table tbody tr').filter(function (r) { return r.querySelector('td.title a'); }); }
  function setFocus(n) {
    var rs = rows(); if (!rs.length) return;
    focusRow = Math.max(0, Math.min(rs.length - 1, n));
    rs.forEach(function (r, i) { r.classList.toggle('is-focus', i === focusRow); });
    rs[focusRow].scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }
  document.addEventListener('keydown', function (e) {
    var open = palette && palette.classList.contains('is-open');
    if (e.key === 'Escape') { if (open) closePalette(); root.removeAttribute('data-nav'); return; }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); if (open) closePalette(); else openPalette(); return; }
    if (open || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    if (e.key === '/') { e.preventDefault(); openPalette(); return; }
    var rs = rows();
    if (!rs.length) return;
    if (e.key === 'j') { e.preventDefault(); setFocus(focusRow + 1); }
    else if (e.key === 'k') { e.preventDefault(); setFocus(focusRow < 0 ? 0 : focusRow - 1); }
    else if (e.key === 'Enter' && focusRow >= 0) { var a = rs[focusRow].querySelector('td.title a'); if (a) window.location.href = a.href; }
    else if (e.key === 'x' && focusRow >= 0) { var c = rs[focusRow].querySelector('input[name=ids]'); if (c) { c.checked = !c.checked; c.dispatchEvent(new Event('change', { bubbles: true })); } }
  });
})();
`;
