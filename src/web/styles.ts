// Giao diện nền trắng, một màu nhấn, viền mảnh, không đổ bóng/gradient. Phục vụ như tệp /assets/app.css
// (không dùng style nội tuyến nên CSP có thể chặn hoàn toàn style/script lạ).
const BASE = `
:root{
  --ink:#1c2024;--ink-2:#4b5563;--ink-3:#6b7280;
  --line:#e5e7eb;--line-2:#d1d5db;--wash:#f9fafb;
  --accent:#17479e;--accent-ink:#fff;
  --ok:#166534;--warn:#9a5b00;--bad:#b42318;
  --ok-bg:#f0f9f3;--warn-bg:#fff8eb;--bad-bg:#fef3f2;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:#fff;color:var(--ink);font:14px/1.5 "Segoe UI",system-ui,-apple-system,"Noto Sans","Noto Sans JP","Yu Gothic UI","Meiryo",sans-serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:20px;font-weight:600;margin:0}
h2{font-size:13px;font-weight:600;margin:0 0 10px;color:var(--ink)}
p{margin:0 0 8px}
.muted{color:var(--ink-3)}.small{font-size:12.5px}.mono{font-family:Consolas,"SFMono-Regular",monospace;font-size:12.5px}

/* khung trang: thanh bên trái + nội dung */
.shell{display:grid;grid-template-columns:240px minmax(0,1fr);min-height:100vh}
.side{border-right:1px solid var(--line);background:#fff;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;padding:18px 14px}
.brand{display:flex;align-items:center;gap:10px;padding:4px 8px 18px;color:var(--ink)}
.brand:hover{text-decoration:none}
.logo{width:30px;height:30px;border-radius:7px;background:var(--accent);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700}
.brand-t{font-weight:600;font-size:15px}.brand-t b{color:var(--accent);font-weight:600}
.nav{flex:1;display:flex;flex-direction:column;gap:2px}
.nav-g{font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);padding:14px 10px 6px}
.nav-i{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:6px;color:var(--ink-2);font-weight:500}
.nav-i:hover{background:var(--wash);color:var(--ink);text-decoration:none}
.nav-i.on{background:#eef3fc;color:var(--accent)}
.ico{width:18px;height:18px;flex:none}
.badge{margin-left:auto;min-width:20px;height:20px;padding:0 6px;border-radius:10px;background:var(--accent);color:#fff;font-size:11.5px;font-weight:600;display:inline-flex;align-items:center;justify-content:center}
.side-f{display:flex;align-items:center;gap:10px;border-top:1px solid var(--line);padding:14px 6px 0}
.side-f form{margin:0 0 0 auto}
.avatar{width:32px;height:32px;border-radius:50%;background:#eef3fc;color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:12px;flex:none}
.who{min-width:0}.who-n{font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.who-r{font-size:12px;color:var(--ink-3)}
.out{border:0;background:none;color:var(--ink-3);cursor:pointer;padding:6px;border-radius:6px;display:flex}.out:hover{background:var(--wash);color:var(--ink)}
.content{min-width:0;background:var(--wash)}
.page{max-width:1240px;margin:0 auto;padding:28px 32px 64px}
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.page-head .sub{color:var(--ink-3);margin-top:2px}
.crumb{font-size:13px;color:var(--ink-3);margin-bottom:6px}

/* chỉ số */
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:20px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:8px;padding:16px 18px}
.kpi-l{font-size:12.5px;color:var(--ink-3);font-weight:500;display:flex;align-items:center;gap:8px}
.kpi-l i{width:8px;height:8px;border-radius:50%;background:var(--ink-3);display:inline-block}
.kpi-l i.c-warn{background:#d97706}.kpi-l i.c-info{background:var(--accent)}.kpi-l i.c-ok{background:var(--ok)}.kpi-l i.c-mute{background:#9ca3af}
.kpi-v{font-size:30px;font-weight:600;line-height:1.15;margin:8px 0 4px;letter-spacing:-.01em}
.kpi-v small{font-size:14px;color:var(--ink-3);font-weight:500;margin-left:4px}
.kpi-s{font-size:12.5px;color:var(--ink-3)}
.kpi-s .up{color:var(--bad);font-weight:600}
.cols{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px;margin-bottom:20px}

/* biểu đồ thanh bằng CSS (không script) */
.stack{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--line);margin:4px 0 14px}
.stack span{display:block;height:100%}
.legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px 18px;font-size:13px}
.legend div{display:flex;align-items:center;gap:8px}
.legend i{width:9px;height:9px;border-radius:2px;flex:none}
.legend b{margin-left:auto;font-weight:600}
.bars{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;height:150px;align-items:end;padding-top:8px}
.bar{display:flex;flex-direction:column;justify-content:flex-end;height:100%;align-items:center;gap:6px}
.bar-col{width:100%;max-width:34px;flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:2px}
.bar-col span{display:block;border-radius:3px 3px 0 0;min-height:0}
.bar-l{font-size:11.5px;color:var(--ink-3)}
.bar-n{font-size:11.5px;font-weight:600;color:var(--ink-2);height:14px}
.key{display:flex;gap:16px;font-size:12.5px;color:var(--ink-3);margin-top:12px}
.key i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:6px}
.c-ok-bg{background:#2f8f5b}.c-mute-bg{background:#c3c9d2}.c-info-bg{background:var(--accent)}.c-warn-bg{background:#e0a03a}.c-bad-bg{background:#d9534a}.c-ink-bg{background:#7b8794}
.split-t{width:100%;border-collapse:collapse}
.split-t th,.split-t td{padding:8px 0;border-bottom:1px solid var(--line);background:none;font-size:13px}
.split-t th{text-align:left;color:var(--ink-3);font-weight:600}.split-t td:not(:first-child),.split-t th:not(:first-child){text-align:right}
.split-t tr:last-child td{border-bottom:0}
.list{list-style:none;margin:0;padding:0}
.list li{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.list li:last-child{border-bottom:0;padding-bottom:0}.list li:first-child{padding-top:0}
.list .when{flex:0 0 96px;font-size:12.5px;color:var(--ink-3)}
.list .what{min-width:0}.list .what .mono{white-space:normal}
.list .what a{color:var(--ink);font-weight:500;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hbar{height:6px;border-radius:3px;background:var(--line);overflow:hidden;margin-top:6px}.hbar span{display:block;height:100%;background:var(--accent)}

/* lịch đăng */
.day{margin-bottom:22px}
.day-h{display:flex;align-items:baseline;gap:10px;margin-bottom:8px}.day-h h2{margin:0;font-size:14px}
.slot{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px 16px;background:#fff;border:1px solid var(--line);border-radius:8px;margin-bottom:8px}
.slot .t{font-weight:600;font-variant-numeric:tabular-nums}
.slot .h a{color:var(--ink);font-weight:500}
.warn-t{color:var(--warn);font-weight:600;font-size:12.5px;white-space:nowrap}

/* nút */
.btn{display:inline-flex;align-items:center;justify-content:center;height:34px;padding:0 14px;border:1px solid var(--line-2);background:#fff;color:var(--ink);border-radius:4px;font:inherit;font-weight:500;cursor:pointer}
.btn:hover{background:var(--wash);text-decoration:none}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.primary:hover{background:#123a82}
.btn.danger{color:var(--bad);border-color:#e4b4af}.btn.danger:hover{background:var(--bad-bg)}
.btn.link{border:0;background:none;height:auto;padding:0;color:var(--accent)}
.btn.sm{height:28px;padding:0 10px;font-size:13px}

/* biểu mẫu */
label{display:block;font-weight:600;font-size:13px;margin:0 0 4px}
.field{margin-bottom:14px}
.hint{font-size:12.5px;color:var(--ink-3);margin-top:4px}
input[type=text],input[type=email],input[type=password],input[type=datetime-local],input[type=number],input[type=time],input[type=url],input[type=search],textarea,select{width:100%;height:34px;padding:0 10px;border:1px solid var(--line-2);border-radius:4px;background:#fff;color:var(--ink);font:inherit}
textarea{height:auto;padding:8px 10px;min-height:96px;resize:vertical;line-height:1.55}
textarea.tall{min-height:260px}
input:focus,textarea:focus,select:focus,input:focus-visible{outline:2px solid #b9cdf2;outline-offset:0;border-color:var(--accent)}
.check{display:flex;gap:8px;align-items:flex-start;font-weight:400;margin:0 0 6px}
.check input{margin-top:3px}

/* thông báo */
.notice{border:1px solid var(--line);border-left-width:3px;padding:10px 14px;margin-bottom:16px;background:var(--wash)}
.notice.ok{border-left-color:var(--ok);background:var(--ok-bg)}
.notice.err{border-left-color:var(--bad);background:var(--bad-bg)}
.notice.warn{border-left-color:var(--warn);background:var(--warn-bg)}

/* bảng */
.table-wrap{border:1px solid var(--line);border-radius:8px;overflow-x:auto;background:#fff}
table{width:100%;border-collapse:collapse}
th{font-size:12px;font-weight:600;color:var(--ink-3);text-align:left;padding:9px 14px;background:var(--wash);border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
tbody tr:hover td{background:#fcfcfd}
td.title a{color:var(--ink);font-weight:500}
td.title a:hover{color:var(--accent)}
.empty{padding:36px 16px;text-align:center;color:var(--ink-3)}

/* trạng thái và thị trường */
.status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.status::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ink-3)}
.status.ok::before{background:var(--ok)}.status.warn::before{background:#d97706}.status.bad::before{background:var(--bad)}.status.info::before{background:var(--accent)}
.tag{display:inline-block;border:1px solid var(--line-2);border-radius:3px;padding:0 6px;font-size:12px;font-weight:600;color:var(--ink-2);line-height:18px}

/* lọc */
.filters{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.seg{background:#fff;display:inline-flex;border:1px solid var(--line-2);border-radius:4px;overflow:hidden}
.seg a{padding:5px 12px;color:var(--ink-2);border-right:1px solid var(--line-2);background:#fff;font-size:13px}
.seg a:last-child{border-right:0}
.seg a:hover{background:var(--wash);text-decoration:none}
.seg a.on{background:var(--ink);color:#fff}
.seg .n{display:inline-block;margin-left:4px;font-size:11.5px;opacity:.7}

/* trang chi tiết */
.split{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:28px;align-items:start}
.panel{border:1px solid var(--line);border-radius:8px;margin-bottom:18px;background:#fff}
.panel-h{padding:11px 16px;border-bottom:1px solid var(--line);font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:8px}
.panel-b{padding:16px}
.facts{display:grid;grid-template-columns:110px 1fr;gap:8px 12px;margin:0;font-size:13px}
.facts dt{color:var(--ink-3)}.facts dd{margin:0;word-break:break-word}

/* xem trước bài đăng */
.fb{border:1px solid var(--line-2);border-radius:6px;background:#fff;max-width:560px}
.fb-h{display:flex;gap:10px;align-items:center;padding:12px 14px}
.fb-av{width:36px;height:36px;border-radius:50%;background:var(--ink);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px}
.fb-name{font-weight:600;line-height:1.2}.fb-sub{font-size:12px;color:var(--ink-3)}
.fb-body{padding:0 14px 12px;white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.55}
.fb-body .hl{font-weight:700;display:block;margin-bottom:6px}
.fb-tags{color:var(--accent);margin-top:8px;display:block}
.fb-card{margin:0 14px 14px;border:1px solid var(--line);border-radius:4px;padding:16px;background:var(--wash)}
.fb-card b{display:block;margin-bottom:6px}
.fb-card ul{margin:0;padding-left:18px}

/* kiểm tra tự động */
.checks{list-style:none;margin:0;padding:0}
.checks li{display:flex;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px}
.checks li:last-child{border-bottom:0}
.checks .k{flex:0 0 18px;font-weight:700}
.checks .pass .k{color:var(--ok)}.checks .fail .k{color:var(--bad)}.checks .note .k{color:var(--warn)}
ol.claims{margin:0 0 12px;padding-left:20px}ol.claims li{margin-bottom:6px}

/* lịch sử */
.timeline{list-style:none;margin:0;padding:0}
.timeline li{padding:0 0 14px 16px;border-left:2px solid var(--line);margin-left:4px;position:relative}
.timeline li::before{content:"";position:absolute;left:-5px;top:5px;width:8px;height:8px;border-radius:50%;background:#fff;border:2px solid var(--ink-3)}
.timeline li:last-child{padding-bottom:0}
.timeline .who{font-weight:600}

details.more{border-top:1px solid var(--line);padding-top:12px;margin-top:14px}
details.more>summary{cursor:pointer;font-weight:600;color:var(--ink-2);margin-bottom:10px}
.actions{display:flex;gap:8px;flex-wrap:wrap}

/* biểu mẫu hai cột */
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}
.form-grid .field.full,.field.full,.form-grid .savebar,.savebar{grid-column:1/-1}
.savebar{display:flex;justify-content:flex-end;gap:10px;padding-top:6px}
.field{margin-bottom:14px;min-width:0}
.field textarea,.form-grid textarea{min-height:88px}
.errlist{margin:6px 0 0;padding-left:20px}
.rules{margin:0;padding-left:20px;line-height:1.75}
.settings{display:flex;flex-direction:column;gap:16px}
.settings .panel{margin:0}
.settings .panel-b{padding-bottom:4px}

/* biểu đồ chi phí theo ngày (cột, CSS thuần) */
.daybars{display:flex;gap:6px;align-items:flex-end;height:180px;overflow-x:auto;padding-bottom:2px}
.dayb{flex:1;min-width:24px;height:100%;display:flex;flex-direction:column;align-items:center}
.dayb-col{flex:1;width:100%;max-width:34px;display:flex;align-items:flex-end;background:#f3f4f6;border-radius:4px;overflow:hidden}
.dayb-col span{display:block;width:100%;background:var(--accent);border-radius:4px 4px 0 0}
.dayb-l{font-size:11px;color:var(--ink-3);margin-top:6px}

/* ảnh thẻ và so sánh bản sửa */
.card-prev{margin-top:14px;text-align:center}
.card-prev img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:8px}
.card-prev .small{margin-top:6px}
.diff-b{margin-bottom:12px}
.diff{font-family:Consolas,"SFMono-Regular",monospace;font-size:12.5px;border:1px solid var(--line);border-radius:6px;overflow:hidden;margin-top:6px}
.diff div{padding:3px 10px;white-space:pre-wrap;word-break:break-word}
.d-add{background:#eaf7ee;color:#166534}
.d-del{background:#fdf0ee;color:#b42318}
.d-eq{color:var(--ink-3)}

/* banner công tắc tạm dừng */
.banner{background:var(--bad-bg);color:var(--bad);border-bottom:1px solid #f1c3bd;padding:10px 32px;font-size:13.5px}

/* thanh công cụ hàng chờ */
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.toolbar form{display:flex;gap:8px;align-items:center;margin:0;flex-wrap:wrap}
.toolbar input[type=search]{height:34px;width:260px;padding:0 10px;border:1px solid var(--line-2);border-radius:4px;font:inherit;background:#fff}
.toolbar select{height:34px;padding:0 8px;border:1px solid var(--line-2);border-radius:4px;font:inherit;background:#fff}
.sep{flex:1}
.secret{background:var(--warn-bg);border:1px solid #f0d9a8;border-radius:6px;padding:12px 14px;margin:0 0 16px}
.secret code{font-family:Consolas,monospace;font-size:14px;background:#fff;padding:2px 8px;border:1px solid var(--line);border-radius:4px;user-select:all}
.inline{display:inline}
.inline form{display:inline}
.tbl-act{display:flex;gap:6px;flex-wrap:wrap}

/* đăng nhập */
.login{max-width:360px;margin:12vh auto 0;padding:0 20px}
.login h1{margin-bottom:4px}
.login .sub{color:var(--ink-3);margin-bottom:24px}
.login .btn{width:100%}

@media (max-width:1000px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cols{grid-template-columns:1fr}}
@media (max-width:900px){
  .split{grid-template-columns:1fr}
  .shell{grid-template-columns:1fr}
  .side{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;padding:10px 14px;border-right:0;border-bottom:1px solid var(--line);gap:8px}
  .brand{padding:0 8px 0 0}.nav{flex-direction:row;flex:1;flex-wrap:wrap}.nav-g{display:none}.side-f{border:0;padding:0}.who{display:none}
  .page{padding:20px 16px 48px}.slot{grid-template-columns:1fr auto}.slot .t,.slot .h{grid-column:1/-1}
}
`;

// Lớp tiện ích w0..w100 (rộng %) và h0..h100 (cao %) để biểu đồ gán theo dữ liệu mà không cần style nội tuyến (CSP).
const steps = Array.from({ length: 101 }, (_, i) => `.w${i}{width:${i}%}.h${i}{height:${i}%}`).join('');
export const CSS = BASE + steps;
