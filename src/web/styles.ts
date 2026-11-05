// Hệ thiết kế PeaPod AI: một bộ token màu (sáng/tối), lưới và component dùng chung.
// Phục vụ như /assets/app.css. Không style nội tuyến, không phông từ bên ngoài (CSP chặn).
// Chế độ tối: theo máy (prefers-color-scheme) mặc định; người dùng có thể ép sáng/tối bằng nút trên thanh đầu (lưu trên trình duyệt).

const TOKENS = `
:root{
  --bg:#f4f6fb;--surface:#ffffff;--surface-2:#f8fafc;--sunken:#eef2f7;
  --line:#e2e8f0;--line-2:#cbd5e1;
  --ink:#0f172a;--ink-2:#334155;--ink-3:#64748b;--ink-4:#94a3b8;
  --brand:#4f46e5;--brand-2:#4338ca;--brand-ink:#ffffff;--brand-soft:#eef2ff;--brand-line:#c7d2fe;
  --ok:#15803d;--ok-soft:#dcfce7;--warn:#b45309;--warn-soft:#fef3c7;--bad:#b91c1c;--bad-soft:#fee2e2;--info:#0369a1;--info-soft:#e0f2fe;
  --shadow:0 1px 2px rgba(15,23,42,.05),0 1px 3px rgba(15,23,42,.06);
  --shadow-lg:0 10px 30px -12px rgba(15,23,42,.18);
  --ring:0 0 0 3px rgba(79,70,229,.25);
  --radius:12px;--radius-sm:8px;
  color-scheme:light;
}
:root[data-theme="dark"]{
  --bg:#0b1120;--surface:#111827;--surface-2:#0f172a;--sunken:#0b1222;
  --line:#1e293b;--line-2:#334155;
  --ink:#e2e8f0;--ink-2:#cbd5e1;--ink-3:#94a3b8;--ink-4:#64748b;
  --brand:#818cf8;--brand-2:#a5b4fc;--brand-ink:#0b1120;--brand-soft:rgba(129,140,248,.14);--brand-line:#3730a3;
  --ok:#4ade80;--ok-soft:rgba(74,222,128,.14);--warn:#fbbf24;--warn-soft:rgba(251,191,36,.14);--bad:#f87171;--bad-soft:rgba(248,113,113,.14);--info:#38bdf8;--info-soft:rgba(56,189,248,.14);
  --shadow:0 1px 2px rgba(0,0,0,.35);--shadow-lg:0 14px 36px -12px rgba(0,0,0,.6);--ring:0 0 0 3px rgba(129,140,248,.35);
  color-scheme:dark;
}
@media (prefers-color-scheme:dark){
  :root:not([data-theme="light"]){
    --bg:#0b1120;--surface:#111827;--surface-2:#0f172a;--sunken:#0b1222;
    --line:#1e293b;--line-2:#334155;
    --ink:#e2e8f0;--ink-2:#cbd5e1;--ink-3:#94a3b8;--ink-4:#64748b;
    --brand:#818cf8;--brand-2:#a5b4fc;--brand-ink:#0b1120;--brand-soft:rgba(129,140,248,.14);--brand-line:#3730a3;
    --ok:#4ade80;--ok-soft:rgba(74,222,128,.14);--warn:#fbbf24;--warn-soft:rgba(251,191,36,.14);--bad:#f87171;--bad-soft:rgba(248,113,113,.14);--info:#38bdf8;--info-soft:rgba(56,189,248,.14);
    --shadow:0 1px 2px rgba(0,0,0,.35);--shadow-lg:0 14px 36px -12px rgba(0,0,0,.6);--ring:0 0 0 3px rgba(129,140,248,.35);
    color-scheme:dark;
  }
}
`;

const BASE = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.55 "Inter","Segoe UI",system-ui,-apple-system,"Noto Sans","Noto Sans JP","Yu Gothic UI","Meiryo",sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
h1{font-size:22px;font-weight:650;letter-spacing:-.01em;margin:0;line-height:1.25}
h2{font-size:13px;font-weight:650;margin:0 0 10px;color:var(--ink-2);text-transform:none;letter-spacing:0}
h3{font-size:15px;font-weight:650;margin:0}
p{margin:0 0 8px}
.muted{color:var(--ink-3)}.small{font-size:12.5px}.mono{font-family:"JetBrains Mono",Consolas,"SFMono-Regular",monospace;font-size:12.5px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:none;box-shadow:var(--ring);border-radius:6px}
.ico{width:18px;height:18px;flex:none}

/* khung: thanh bên, thanh đầu, nội dung, chân trang */
.shell{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;background:var(--surface) url('/assets/side-bg.svg') no-repeat center top/100% auto;border-right:1px solid var(--line);padding:18px 14px;overflow-y:auto}
.brand{display:flex;align-items:center;gap:11px;padding:4px 8px 20px;color:var(--ink)}
.brand:hover{text-decoration:none}
.logo{width:36px;height:36px;flex:none;display:block;filter:drop-shadow(0 6px 12px rgba(79,70,229,.35))}
.brand-t{font-weight:650;font-size:15.5px;letter-spacing:-.01em}.brand-t b{color:var(--brand);font-weight:650}
.nav{flex:1;display:flex;flex-direction:column;gap:2px}
.nav-g{font-size:11px;font-weight:650;letter-spacing:.07em;text-transform:uppercase;color:var(--ink-4);padding:16px 10px 6px}
.nav-i{position:relative;display:flex;align-items:center;gap:11px;padding:8px 10px;border-radius:var(--radius-sm);color:var(--ink-2);font-weight:550;transition:background .15s,color .15s}
.nav-i:hover{background:var(--sunken);color:var(--ink);text-decoration:none}
.nav-i.on{background:var(--brand-soft);color:var(--brand)}
.nav-i.on::before{content:"";position:absolute;left:-14px;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;background:var(--brand)}
.badge{margin-left:auto;min-width:22px;height:20px;padding:0 7px;border-radius:999px;background:var(--brand);color:var(--brand-ink);font-size:11.5px;font-weight:650;display:inline-flex;align-items:center;justify-content:center}
.side-f{display:flex;align-items:center;gap:10px;border-top:1px solid var(--line);padding:14px 4px 0;margin-top:12px}
.side-f form{margin:0 0 0 auto}
.avatar{width:34px;height:34px;border-radius:50%;background:var(--brand-soft);color:var(--brand);display:flex;align-items:center;justify-content:center;font-weight:650;font-size:12px;flex:none}
.who{min-width:0;color:inherit;flex:1}.who:hover{text-decoration:none}
.who-n{font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--ink)}
.who-r{font-size:12px;color:var(--ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.out{border:0;background:none;color:var(--ink-3);cursor:pointer;padding:7px;border-radius:var(--radius-sm);display:flex}
.out:hover{background:var(--sunken);color:var(--ink)}

.content{min-width:0;display:flex;flex-direction:column;min-height:100vh}
.topbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;height:60px;padding:0 28px;background:color-mix(in srgb,var(--surface) 88%,transparent);backdrop-filter:saturate(1.4) blur(10px);border-bottom:1px solid var(--line)}
.topbar .grow{flex:1}
.theme{display:inline-flex;padding:3px;background:var(--sunken);border:1px solid var(--line);border-radius:999px;gap:2px}
.theme button{border:0;background:transparent;color:var(--ink-3);font:inherit;font-size:12.5px;font-weight:550;padding:5px 11px;border-radius:999px;cursor:pointer;display:flex;align-items:center;gap:6px}
.theme button:hover{color:var(--ink)}
.theme button[aria-pressed="true"]{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
.iconbtn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:var(--radius-sm);color:var(--ink-2);border:1px solid transparent}
.iconbtn:hover{background:var(--sunken);color:var(--ink);text-decoration:none}
.iconbtn .dot{position:absolute;top:6px;right:6px;width:8px;height:8px;border-radius:50%;background:var(--bad);border:2px solid var(--surface)}
.usermenu{position:relative}
.usermenu summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:9px;padding:4px 8px 4px 4px;border-radius:999px;border:1px solid var(--line)}
.usermenu summary::-webkit-details-marker{display:none}
.usermenu summary:hover{background:var(--sunken)}
.usermenu .avatar{width:28px;height:28px;font-size:11px}
.usermenu .nm{font-size:13px;font-weight:550;color:var(--ink);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.menu{position:absolute;right:0;top:calc(100% + 8px);min-width:220px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow-lg);padding:6px;z-index:30}
.menu a,.menu button{display:flex;width:100%;align-items:center;gap:10px;padding:9px 10px;border-radius:var(--radius-sm);color:var(--ink-2);font:inherit;text-align:left;background:none;border:0;cursor:pointer}
.menu a:hover,.menu button:hover{background:var(--sunken);color:var(--ink);text-decoration:none}
.menu hr{border:0;border-top:1px solid var(--line);margin:6px 0}
.banner{background:var(--bad-soft);color:var(--bad);border-bottom:1px solid color-mix(in srgb,var(--bad) 30%,transparent);padding:11px 28px;font-size:13.5px}
.page{width:100%;max-width:1800px;margin:0 auto;padding:28px clamp(20px,2.4vw,40px) 40px;flex:1}
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:22px;flex-wrap:wrap}
.page-head .sub{color:var(--ink-3);margin-top:4px;max-width:760px}
.crumb{font-size:12.5px;color:var(--ink-3);margin-bottom:6px;font-weight:550}
.footer{border-top:1px solid var(--line);padding:14px 28px;display:flex;align-items:center;gap:18px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-3);background:var(--surface)}
.footer .grow{flex:1}
.footer a{color:var(--ink-3)}
.footer .sep-dot{width:3px;height:3px;border-radius:50%;background:var(--ink-4)}
.live{display:inline-flex;align-items:center;gap:6px}
.live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)}

/* thẻ và khối */
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);margin-bottom:18px;overflow:hidden}
.panel-h{padding:14px 18px;border-bottom:1px solid var(--line);font-weight:650;display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:14px}
.panel-h .small{font-weight:400}
.panel-b{padding:18px}
.table-wrap{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);overflow:auto}
.empty{padding:40px 18px;text-align:center;color:var(--ink-3)}
.grid-cards{display:grid;gap:16px}

/* chỉ số */
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:22px}
.kpi{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:18px 18px 16px;box-shadow:var(--shadow);position:relative;overflow:hidden}
.kpi::after{content:"";position:absolute;right:-30px;top:-30px;width:90px;height:90px;border-radius:50%;background:var(--brand-soft);opacity:.6}
.kpi-l{font-size:12.5px;color:var(--ink-3);font-weight:600;display:flex;align-items:center;gap:8px}
.kpi-l i{width:8px;height:8px;border-radius:50%;background:var(--ink-4);display:inline-block}
.kpi-l i.c-warn{background:var(--warn)}.kpi-l i.c-info{background:var(--brand)}.kpi-l i.c-ok{background:var(--ok)}.kpi-l i.c-mute{background:var(--ink-4)}
.kpi-v{font-size:30px;font-weight:700;line-height:1.1;margin:10px 0 6px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kpi-v small{font-size:13px;color:var(--ink-3);font-weight:600;margin-left:5px;letter-spacing:0}
.kpi-s{font-size:12.5px;color:var(--ink-3)}
.kpi-s .up{color:var(--bad);font-weight:650}
.split{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:24px;align-items:start}
.cols{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px;margin-bottom:20px;align-items:start}
.hbar{height:6px;border-radius:999px;background:var(--sunken);overflow:hidden;margin-top:10px}.hbar span{display:block;height:100%;background:linear-gradient(90deg,var(--brand),#8b5cf6);border-radius:999px}

/* biểu đồ CSS */
.stack{display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--sunken);margin:4px 0 16px}
.stack span{display:block;height:100%}
.legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px 22px;font-size:13px}
.legend div{display:flex;align-items:center;gap:9px}
.legend i{width:9px;height:9px;border-radius:3px;flex:none}
.legend b{margin-left:auto;font-weight:650;font-variant-numeric:tabular-nums}
.bars{display:grid;grid-template-columns:repeat(7,1fr);gap:12px;height:160px;align-items:end;padding-top:8px}
.bar{display:flex;flex-direction:column;justify-content:flex-end;height:100%;align-items:center;gap:6px}
.bar-col{width:100%;max-width:38px;flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:2px}
.bar-col span{display:block;border-radius:6px 6px 2px 2px;min-height:0}
.bar-l{font-size:11.5px;color:var(--ink-3)}
.bar-n{font-size:11.5px;font-weight:650;color:var(--ink-2);height:14px;font-variant-numeric:tabular-nums}
.key{display:flex;gap:16px;font-size:12.5px;color:var(--ink-3);margin-top:14px;flex-wrap:wrap}
.key i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px}
.c-ok-bg{background:var(--ok)}.c-mute-bg{background:var(--sunken);border:1px solid var(--line-2)}.c-info-bg{background:var(--brand)}.c-warn-bg{background:var(--warn)}.c-bad-bg{background:var(--bad)}.c-ink-bg{background:var(--ink-4)}
.daybars{display:flex;gap:6px;align-items:flex-end;height:180px;overflow-x:auto;padding-bottom:2px}
.dayb{flex:1;min-width:24px;height:100%;display:flex;flex-direction:column;align-items:center}
.dayb-col{flex:1;width:100%;max-width:34px;display:flex;align-items:flex-end;background:var(--sunken);border-radius:6px;overflow:hidden}
.dayb-col span{display:block;width:100%;background:linear-gradient(180deg,#818cf8,var(--brand));border-radius:6px 6px 2px 2px}
.dayb-l{font-size:11px;color:var(--ink-3);margin-top:6px}

/* bảng */
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;font-weight:650;color:var(--ink-3);background:var(--surface-2);white-space:nowrap;letter-spacing:.01em}
tbody tr{transition:background .12s}
tbody tr:hover td{background:var(--surface-2)}
tr:last-child td{border-bottom:0}
td.title a{color:var(--ink);font-weight:600}
td.title a:hover{color:var(--brand)}
.split-t{width:100%;border-collapse:collapse}
.split-t th,.split-t td{padding:9px 0;border-bottom:1px solid var(--line);background:none;font-size:13px}
.split-t th{text-align:left;color:var(--ink-3)}.split-t td:not(:first-child),.split-t th:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
.split-t tr:last-child td{border-bottom:0}

/* trạng thái, thẻ nhãn */
.status{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;font-weight:550;font-size:13px}
.status::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ink-4)}
.status.ok::before{background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)}
.status.warn::before{background:var(--warn);box-shadow:0 0 0 3px var(--warn-soft)}
.status.bad::before{background:var(--bad);box-shadow:0 0 0 3px var(--bad-soft)}
.status.info::before{background:var(--brand);box-shadow:0 0 0 3px var(--brand-soft)}
.tag{display:inline-flex;align-items:center;border:1px solid var(--line-2);border-radius:6px;padding:1px 7px;font-size:11.5px;font-weight:650;color:var(--ink-2);line-height:18px;background:var(--surface-2)}
.chip{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;background:var(--sunken);font-size:12px;color:var(--ink-2)}

/* nút */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 15px;border:1px solid var(--line-2);background:var(--surface);color:var(--ink);border-radius:var(--radius-sm);font:inherit;font-weight:600;font-size:13.5px;cursor:pointer;text-decoration:none;box-shadow:var(--shadow);transition:background .15s,border-color .15s,transform .05s}
.btn:hover{background:var(--surface-2);text-decoration:none;border-color:var(--ink-4)}
.btn:active{transform:translateY(1px)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn.primary{background:linear-gradient(180deg,#6366f1,var(--brand-2));border-color:transparent;color:#fff;box-shadow:0 6px 14px -6px rgba(79,70,229,.6)}
.btn.primary:hover{filter:brightness(1.06);background:linear-gradient(180deg,#6366f1,var(--brand-2))}
.btn.danger{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 35%,transparent)}
.btn.danger:hover{background:var(--bad-soft)}
.btn.ghost{background:transparent;border-color:transparent;box-shadow:none;color:var(--ink-2)}
.btn.ghost:hover{background:var(--sunken)}
.btn.sm{height:30px;padding:0 10px;font-size:12.5px;border-radius:7px}
.btn.lg{height:42px;padding:0 20px;font-size:14.5px}
.btn.block{width:100%}
.btn.link{border:0;background:none;box-shadow:none;height:auto;padding:0;color:var(--brand)}
.btn-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}

/* biểu mẫu */
label{display:block;font-weight:600;font-size:13px;margin:0 0 6px;color:var(--ink-2)}
.field{margin-bottom:16px;min-width:0}
.field.full,.form-grid .field.full,.form-grid .savebar,.savebar{grid-column:1/-1}
.hint{font-size:12.5px;color:var(--ink-3);margin-top:6px}
.pager{display:flex;align-items:center;justify-content:center;gap:14px;margin:18px 0 8px;flex-wrap:wrap}
.pager .btn[aria-disabled="true"]{opacity:.45;pointer-events:none}
.tag.bad-tag{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 35%,transparent);background:var(--bad-soft);margin-left:6px}
.verdicts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:20px}
.verdict{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow);padding:18px 20px;border-left:4px solid var(--ink-4)}
.verdict.ok{border-left-color:var(--ok)}
.verdict.bad{border-left-color:var(--bad)}
.verdict-h{display:flex;align-items:center;gap:8px}
.verdict-dot{width:8px;height:8px;border-radius:50%;background:var(--ink-4)}
.verdict.ok .verdict-dot{background:var(--ok);box-shadow:0 0 0 3px var(--ok-soft)}
.verdict.bad .verdict-dot{background:var(--bad);box-shadow:0 0 0 3px var(--bad-soft)}
.verdict-v{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:8px 0 4px}
.meter{height:8px;border-radius:99px;background:var(--surface-2);border:1px solid var(--line);overflow:hidden;margin:6px 0 8px;min-width:120px}
.meter span{display:block;height:100%;border-radius:99px;transition:width .3s}
.day{margin-bottom:26px}
.day-h{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.day-h h2{font-size:15px;font-weight:650;margin:0;text-transform:capitalize}
.slot{display:grid;grid-template-columns:110px minmax(0,1fr) 170px;gap:16px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius-sm);padding:12px 16px;margin-bottom:8px}
.slot .t{font-weight:650;font-variant-numeric:tabular-nums;font-size:14px}
.slot .h{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slot .h a{color:var(--ink);font-weight:550}
.slot .h a:hover{color:var(--brand)}
@media (max-width:760px){.verdicts{grid-template-columns:1fr}.slot{grid-template-columns:1fr;gap:6px}.slot .h{white-space:normal}}
input[type=text],input[type=email],input[type=password],input[type=datetime-local],input[type=date],input[type=number],input[type=time],input[type=url],input[type=search],textarea,select{width:100%;height:38px;padding:0 12px;border:1px solid var(--line-2);border-radius:var(--radius-sm);background:var(--surface);color:var(--ink);font:inherit;font-size:14px;transition:border-color .15s,box-shadow .15s;appearance:auto}
textarea{height:auto;padding:10px 12px;min-height:96px;resize:vertical;line-height:1.6}
textarea.tall{min-height:260px}
select{padding-right:8px}
input::placeholder,textarea::placeholder{color:var(--ink-4)}
input:hover,textarea:hover,select:hover{border-color:var(--ink-4)}
input:focus,textarea:focus,select:focus,input:focus-visible{outline:none;border-color:var(--brand);box-shadow:var(--ring)}
input:disabled,textarea:disabled,select:disabled{opacity:.6;background:var(--sunken)}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}
.check{display:flex;gap:9px;align-items:flex-start;font-weight:450;margin:0 0 8px;color:var(--ink-2);cursor:pointer}
.check input{width:16px;height:16px;margin-top:2px;accent-color:var(--brand)}
.savebar{display:flex;justify-content:flex-end;gap:10px;padding-top:6px;align-items:center}
.inline-label{display:flex;gap:8px;align-items:center;font-weight:600;font-size:13px;color:var(--ink-2)}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.toolbar form{display:flex;gap:8px;align-items:center;margin:0;flex-wrap:wrap}
.toolbar input[type=search]{width:280px}
.toolbar select{width:auto;min-width:110px;height:36px}
.toolbar-form{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0}
.toolbar-form select{width:auto;min-width:120px}
.sep{flex:1}
.hidden{display:none}

/* thông báo */
.notice{display:flex;gap:10px;align-items:flex-start;border:1px solid var(--line);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:18px;background:var(--surface);color:var(--ink-2);font-size:13.5px}
.notice::before{content:"";width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:var(--ink-4)}
.notice.ok{background:var(--ok-soft);border-color:color-mix(in srgb,var(--ok) 25%,transparent);color:var(--ink)}.notice.ok::before{background:var(--ok)}
.notice.err{background:var(--bad-soft);border-color:color-mix(in srgb,var(--bad) 25%,transparent);color:var(--ink)}.notice.err::before{background:var(--bad)}
.notice.warn{background:var(--warn-soft);border-color:color-mix(in srgb,var(--warn) 25%,transparent);color:var(--ink)}.notice.warn::before{background:var(--warn)}
.errlist{margin:6px 0 0;padding-left:20px}
.warn-t{color:var(--warn);font-weight:650;font-size:12.5px;white-space:nowrap}

/* lọc (tab phân đoạn) */
.filters{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.seg{display:inline-flex;background:var(--sunken);border:1px solid var(--line);border-radius:var(--radius-sm);padding:3px;gap:2px;flex-wrap:wrap}
.seg a{padding:6px 12px;color:var(--ink-3);border-radius:6px;font-size:13px;font-weight:550;white-space:nowrap}
.seg a:hover{color:var(--ink);text-decoration:none}
.seg a.on{background:var(--surface);color:var(--ink);box-shadow:var(--shadow)}
.seg .n{display:inline-block;margin-left:6px;font-size:11.5px;color:var(--ink-3);font-variant-numeric:tabular-nums}

/* danh sách, dòng thời gian, kiểm tra */
.list{list-style:none;margin:0;padding:0}
.list li{display:flex;gap:14px;padding:11px 0;border-bottom:1px solid var(--line)}
.list li:last-child{border-bottom:0;padding-bottom:0}.list li:first-child{padding-top:0}
.list .when{flex:0 0 104px;font-size:12.5px;color:var(--ink-3);font-variant-numeric:tabular-nums}
.list .what{min-width:0;display:flex;flex-direction:column;gap:2px}
.list .what a,.list .what span:first-child{color:var(--ink);font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list .what a:hover{color:var(--brand)}
.checks{list-style:none;margin:0;padding:0}
.checks li{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid var(--line);font-size:13.5px;align-items:flex-start}
.checks li:last-child{border-bottom:0}
.checks .k{flex:0 0 20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:750;font-size:11px}
.checks .pass .k{background:var(--ok-soft);color:var(--ok)}.checks .fail .k{background:var(--bad-soft);color:var(--bad)}.checks .note .k{background:var(--warn-soft);color:var(--warn)}
.timeline{list-style:none;margin:0;padding:0}
.timeline li{padding:0 0 16px 18px;border-left:2px solid var(--line);margin-left:5px;position:relative}
.timeline li::before{content:"";position:absolute;left:-7px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--surface);border:2px solid var(--brand)}
.timeline li:last-child{padding-bottom:0}
.timeline .who{font-weight:650}
ol.claims{margin:0 0 12px;padding-left:20px}ol.claims li{margin-bottom:7px}
.rules{margin:0;padding-left:20px;line-height:1.8;color:var(--ink-2)}
.facts{display:grid;grid-template-columns:118px 1fr;gap:10px 14px;margin:0;font-size:13.5px}
.facts dt{color:var(--ink-3)}.facts dd{margin:0;word-break:break-word;font-variant-numeric:tabular-nums}
details.more{border-top:1px solid var(--line);padding-top:12px;margin-top:14px}
details.more>summary{cursor:pointer;font-weight:600;color:var(--ink-2);margin-bottom:10px;list-style:none}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::before{content:"▸ ";color:var(--ink-3)}
details[open].more>summary::before{content:"▾ "}
.actions{display:flex;gap:8px;flex-wrap:wrap}
.secret{background:var(--warn-soft);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);border-radius:var(--radius);padding:14px 16px;margin:0 0 18px}
.secret code{font-family:"JetBrains Mono",Consolas,monospace;font-size:14px;background:var(--surface);padding:3px 9px;border:1px solid var(--line);border-radius:6px;user-select:all}
.tbl-act{display:flex;gap:6px;justify-content:flex-end;flex-wrap:nowrap;align-items:center}
.btn{white-space:nowrap}
.right{text-align:right}
.nowrap{white-space:nowrap}
.strong{font-weight:600;color:var(--ink)}
table.users td{vertical-align:middle}
.tags{display:flex;gap:6px;flex-wrap:wrap}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.chip-check{position:relative;display:inline-flex;align-items:center;margin:0;cursor:pointer;font-weight:550;color:var(--ink-2)}
.chip-check input{position:absolute;opacity:0;width:0;height:0}
.chip-check span{padding:7px 14px;border:1px solid var(--line-2);border-radius:999px;background:var(--surface);font-size:13px;transition:all .15s}
.chip-check:hover span{border-color:var(--ink-4)}
.chip-check input:checked+span{background:var(--brand-soft);border-color:var(--brand);color:var(--brand)}
.chip-check input:focus-visible+span{box-shadow:var(--ring)}
.inline{display:inline}.inline form{display:inline}

/* xem trước bài đăng (giống Facebook) */
.fb{border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);max-width:580px;box-shadow:var(--shadow)}
.fb-h{display:flex;gap:11px;align-items:center;padding:14px 16px}
.fb-av{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#6366f1,#8b5cf6);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:750;font-size:14px}
.fb-name{font-weight:650;line-height:1.2}.fb-sub{font-size:12px;color:var(--ink-3)}
.fb-body{padding:0 16px 14px;white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.6}
.fb-body .hl{font-weight:700;display:block;margin-bottom:6px}
.fb-tags{color:var(--brand);margin-top:8px;display:block}
.fb-card{margin:0 16px 16px;border:1px solid var(--line);border-radius:var(--radius-sm);padding:16px;background:var(--surface-2)}
.fb-card b{display:block;margin-bottom:6px}
.fb-card ul{margin:0;padding-left:18px}
.card-prev{margin-top:16px;text-align:center}
.reel-prev{display:block;margin:0 auto;width:270px;max-width:100%;aspect-ratio:9/16;background:#000;border-radius:var(--radius);border:1px solid var(--line)}
.row-gap{display:flex;align-items:center;gap:12px}
.reel-progress{margin:0 0 12px;padding:12px 14px;border:1px solid var(--line);border-radius:var(--radius);background:var(--sunken)}
.reel-progress.compact{margin:0;padding:0;border:0;background:none;min-width:200px}
.reel-bar{display:block;width:100%;height:10px;border:0;border-radius:99px;overflow:hidden;appearance:none;-webkit-appearance:none;background:var(--line)}
.reel-bar::-webkit-progress-bar{background:var(--line);border-radius:99px}
.reel-bar::-webkit-progress-value{background:var(--brand);border-radius:99px;transition:width .4s ease}
.reel-bar::-moz-progress-bar{background:var(--brand);border-radius:99px}
.reel-progress.compact .reel-bar{height:6px}
.reel-meta{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px;font-size:13px;color:var(--ink-2)}
.reel-meta b{color:var(--ink);font-variant-numeric:tabular-nums}
.reel-row{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
.reel-row .btn{padding:4px 12px;font-size:13px}
.studio-wrap{position:relative;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden;background:#1e1e1e;box-shadow:0 1px 2px rgba(0,0,0,.06)}
.studio-wrap::before{content:"Đang tải Remotion Studio…";position:absolute;inset:0;display:grid;place-items:center;color:#9ca3af;font-size:14px}
.studio-frame{position:relative;display:block;width:100%;height:calc(100vh - 230px);min-height:620px;border:0;background:transparent}
.studio-foot{margin:10px 2px 0}
@media (max-width:900px){.studio-frame{height:72vh;min-height:480px}}
.card-prev img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
.card-prev .small{margin-top:8px}
.diff-b{margin-bottom:14px}
.diff{font-family:"JetBrains Mono",Consolas,monospace;font-size:12.5px;border:1px solid var(--line);border-radius:var(--radius-sm);overflow:hidden;margin-top:6px;background:var(--surface-2)}
.diff div{padding:4px 12px;white-space:pre-wrap;word-break:break-word}
.d-add{background:var(--ok-soft);color:var(--ok)}
.d-del{background:var(--bad-soft);color:var(--bad)}
.d-eq{color:var(--ink-3)}

/* đề xuất chủ đề và tạo bài */
.topics{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:14px}
.topic{border:1px solid var(--line);border-radius:var(--radius);padding:16px;display:flex;flex-direction:column;gap:8px;background:var(--surface);box-shadow:var(--shadow);transition:border-color .15s,transform .15s}
.topic:hover{border-color:var(--brand-line);transform:translateY(-1px)}
.topic h3{font-size:15px;line-height:1.4}
.topic form{margin-top:auto;padding-top:10px}
.topic-src{margin:0;padding-left:18px;line-height:1.6}
.steps{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap}
.step{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-3);font-weight:600}
.step b{width:24px;height:24px;border-radius:50%;background:var(--sunken);color:var(--ink-2);display:inline-flex;align-items:center;justify-content:center;font-size:12px}
.step.on{color:var(--ink)}.step.on b{background:var(--brand);color:var(--brand-ink)}

/* đăng nhập: chia đôi. Trái là khối thương hiệu có chuyển động, phải là form. */
.auth{min-height:100vh;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr);background:var(--bg)}
.auth-art{position:relative;overflow:hidden;color:#fff;padding:44px 52px;display:flex;flex-direction:column;background:linear-gradient(135deg,#1e1b4b 0%,#3730a3 45%,#4f46e5 75%,#7c3aed 100%);background-size:200% 200%;animation:authShift 16s ease-in-out infinite}
.auth-art .orb{position:absolute;border-radius:50%;filter:blur(40px);opacity:.55;pointer-events:none;animation:authFloat 14s ease-in-out infinite}
.auth-art .o1{width:360px;height:360px;background:#a5b4fc;top:-120px;right:-100px}
.auth-art .o2{width:280px;height:280px;background:#c4b5fd;bottom:-90px;left:-70px;animation-delay:-6s}
.auth-brand-lg{position:relative;display:flex;align-items:center;gap:12px;font-size:18px;font-weight:700;letter-spacing:-.01em}
.auth-brand-lg b{color:#c7d2fe}
.auth-copy{position:relative;margin-top:auto;margin-bottom:auto;max-width:520px;padding:32px 0}
.auth-copy h2{font-size:38px;line-height:1.12;letter-spacing:-.025em;margin:0 0 16px;font-weight:750;color:#fff;animation:authUp .7s ease both}
.auth-copy > p{font-size:16px;line-height:1.55;color:rgba(255,255,255,.85);margin:0 0 30px;max-width:460px;animation:authUp .7s .1s ease both}
.auth-points{list-style:none;padding:0;margin:0;display:grid;gap:14px}
.auth-points li{display:flex;gap:12px;align-items:flex-start;font-size:14.5px;color:rgba(255,255,255,.92);animation:authUp .6s ease both}
.auth-points li:nth-child(2){animation-delay:.12s}
.auth-points li:nth-child(3){animation-delay:.24s}
.auth-points .ck{flex:none;width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.16);display:grid;place-items:center;font-size:12px;font-weight:700;color:#a7f3d0}
.auth-art-foot{position:relative;font-size:12px;color:rgba(255,255,255,.7)}
.auth-form{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px 28px}
.auth-form .theme{position:absolute;top:18px;right:18px}
.auth-card{width:100%;max-width:400px;animation:authUp .6s .05s ease both}
.auth-card h1{font-size:26px;margin:0 0 8px;letter-spacing:-.02em}
.auth-card .sub{color:var(--ink-3);margin:0 0 26px;font-size:14.5px}
.auth-card .field input{transition:border-color .18s,box-shadow .18s}
.auth-card .field input:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 4px var(--brand-soft)}
.auth-card .btn.block{width:100%;height:46px;font-size:15px;margin-top:8px;transition:transform .15s,box-shadow .15s}
.auth-card .btn.block:hover{transform:translateY(-1px);box-shadow:0 10px 24px -8px var(--brand)}
.auth-help{font-size:12.5px;color:var(--ink-3);margin:22px 0 0;text-align:center}
.auth-foot{margin-top:auto;padding-top:28px;font-size:12px;color:var(--ink-4);text-align:center}
@keyframes authUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes authFloat{0%,100%{transform:translate(0,0)}50%{transform:translate(18px,-22px)}}
@keyframes authShift{0%,100%{background-position:0% 50%}50%{background-position:100% 50%}}
@media (prefers-reduced-motion:reduce){.auth *,.auth-art{animation:none!important}}
@media (max-width:900px){
  .auth{grid-template-columns:minmax(0,1fr)}
  .auth-art{padding:22px 24px}
  .auth-copy,.auth-art-foot{display:none}
  .auth-art{min-height:0}
  .auth-form{padding:20px 20px 24px}
  .auth-form .theme{position:static;align-self:flex-end;margin:0 0 12px}
  .auth-card h1{font-size:23px}
}

@media (max-width:1100px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cols{grid-template-columns:1fr}}
@media (max-width:980px){
  .shell{grid-template-columns:1fr}
  .side{position:static;height:auto;flex-direction:row;flex-wrap:wrap;align-items:center;padding:10px 14px;border-right:0;border-bottom:1px solid var(--line);gap:6px}
  .brand{padding:0 8px 0 0}
  .nav{flex-direction:row;flex-wrap:wrap;flex:1;gap:4px}
  .nav-g{display:none}
  .nav-i.on::before{display:none}
  .side-f{border:0;padding:0;margin:0}.who{display:none}
  .topbar{padding:0 16px}
  .page{padding:20px 16px 36px}
  .footer{padding:14px 16px}
  .form-grid{grid-template-columns:1fr}
  .split{grid-template-columns:1fr}
  .toolbar input[type=search]{width:100%}
}
@media (max-width:640px){
  .kpis{grid-template-columns:1fr}
  .legend{grid-template-columns:1fr}
  .usermenu .nm{display:none}
  .theme button span.lbl{display:none}
  .page-head h1{font-size:20px}
}
`;

// Lớp tiện ích w0..w100 (rộng %) và h0..h100 (cao %) để biểu đồ gán theo dữ liệu mà không cần style nội tuyến (CSP).
const steps = Array.from({ length: 101 }, (_, i) => `.w${i}{width:${i}%}.h${i}{height:${i}%}`).join('');

export const CSS = TOKENS + BASE + steps;
