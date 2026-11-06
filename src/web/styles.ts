// Hệ thiết kế PeaPod AI v3 "bàn điều khiển biên tập". Viết lại từ đầu.
// Phục vụ tại /assets/app.css. CSP chỉ cho style và font từ chính máy chủ: không style nội tuyến, không font ngoài.
//
// Ý tưởng: người duyệt là người điều hành một tòa soạn nhỏ. Thanh bên tối giữ vai "bảng điều khiển", vùng nội dung sáng giữ vai
// "mặt bàn đọc". Ba thứ làm nên bản sắc: vạch rủi ro bên trái mỗi bài, vòng điểm chất lượng, và chuyển động có chủ đích
// (chuyển trang bằng View Transitions, vạch menu trượt theo trang, số đếm lên). Mọi chuyển động tắt khi người dùng chọn giảm chuyển động.

// --- Font tự lưu trữ (nạp theo ký tự: máy chỉ tải font Nhật khi trang có chữ Nhật) ---
const FONTS = `
@font-face{font-family:"Noto Sans PP";font-weight:400;font-style:normal;font-display:swap;src:url(/assets/fonts/latin-400.woff) format("woff");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Noto Sans PP";font-weight:500;font-style:normal;font-display:swap;src:url(/assets/fonts/latin-500.woff) format("woff");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Noto Sans PP";font-weight:600;font-style:normal;font-display:swap;src:url(/assets/fonts/latin-600.woff) format("woff");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Noto Sans PP";font-weight:700;font-style:normal;font-display:swap;src:url(/assets/fonts/latin-700.woff) format("woff");unicode-range:U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD}
@font-face{font-family:"Noto Sans PP";font-weight:400;font-style:normal;font-display:swap;src:url(/assets/fonts/vietnamese-400.woff) format("woff");unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB}
@font-face{font-family:"Noto Sans PP";font-weight:500;font-style:normal;font-display:swap;src:url(/assets/fonts/vietnamese-500.woff) format("woff");unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB}
@font-face{font-family:"Noto Sans PP";font-weight:600;font-style:normal;font-display:swap;src:url(/assets/fonts/vietnamese-600.woff) format("woff");unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB}
@font-face{font-family:"Noto Sans PP";font-weight:700;font-style:normal;font-display:swap;src:url(/assets/fonts/vietnamese-700.woff) format("woff");unicode-range:U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB}
@font-face{font-family:"Noto Sans PP";font-weight:400 600;font-style:normal;font-display:swap;src:url(/assets/fonts/jp-400.woff) format("woff");unicode-range:U+2E80-2FDF,U+3000-303F,U+3040-30FF,U+31F0-31FF,U+3400-4DBF,U+4E00-9FFF,U+FF00-FFEF}
@font-face{font-family:"Noto Sans PP";font-weight:700;font-style:normal;font-display:swap;src:url(/assets/fonts/jp-700.woff) format("woff");unicode-range:U+2E80-2FDF,U+3000-303F,U+3040-30FF,U+31F0-31FF,U+3400-4DBF,U+4E00-9FFF,U+FF00-FFEF}
@property --p{syntax:"<number>";inherits:false;initial-value:0}
`;

// --- Token màu, hình khối, chuyển động ---
const LIGHT = `
  --bg:#f1f3f8;--surface:#ffffff;--surface-2:#f7f8fc;--sunken:#e9edf5;
  --line:#e1e6ef;--line-2:#cdd5e2;
  --ink:#0e1628;--ink-2:#313b50;--ink-3:#5a6579;--ink-4:#8a95a8;
  --brand:#3355ff;--brand-2:#2440d9;--brand-ink:#ffffff;--brand-soft:#e8edff;--brand-line:#bccaff;--brand-glow:rgba(51,85,255,.45);
  --ok:#0f9d58;--ok-soft:#ddf5e8;--ok-ink:#0a6b3c;
  --warn:#d98300;--warn-soft:#fff1d6;--warn-ink:#8a5200;
  --bad:#dc3545;--bad-soft:#ffe3e6;--bad-ink:#b0202f;
  --info:#2678e5;--info-soft:#e1eeff;--info-ink:#1a56a8;
  --rail:#0b1220;--rail-2:#131c30;--rail-line:#1c2740;--rail-ink:#c4cde0;--rail-ink-2:#8794ad;--rail-accent:#8fa4ff;
  --sh-1:0 1px 2px rgba(14,22,40,.06),0 1px 1px rgba(14,22,40,.04);
  --sh-2:0 6px 18px -8px rgba(14,22,40,.2),0 2px 4px rgba(14,22,40,.05);
  --sh-pop:0 24px 48px -18px rgba(14,22,40,.4),0 4px 10px rgba(14,22,40,.08);
  --ring:0 0 0 4px rgba(51,85,255,.22);
`;
const DARK = `
  --bg:#080d18;--surface:#0f1626;--surface-2:#0c1220;--sunken:#0a0f1c;
  --line:#1b2540;--line-2:#2a3858;
  --ink:#e8edf8;--ink-2:#c5cde0;--ink-3:#93a0ba;--ink-4:#65718c;
  --brand:#7d93ff;--brand-2:#a3b3ff;--brand-ink:#080d18;--brand-soft:rgba(125,147,255,.14);--brand-line:#2f3f8f;--brand-glow:rgba(125,147,255,.4);
  --ok:#3ddc84;--ok-soft:rgba(61,220,132,.13);--ok-ink:#6ee7a1;
  --warn:#fbbf24;--warn-soft:rgba(251,191,36,.13);--warn-ink:#fcd34d;
  --bad:#ff6b78;--bad-soft:rgba(255,107,120,.14);--bad-ink:#ff9aa3;
  --info:#5aa7ff;--info-soft:rgba(90,167,255,.14);--info-ink:#8cc2ff;
  --rail:#060a14;--rail-2:#0d1424;--rail-line:#16203a;--rail-ink:#b9c3d9;--rail-ink-2:#7a87a1;--rail-accent:#8fa4ff;
  --sh-1:0 1px 2px rgba(0,0,0,.4);--sh-2:0 8px 22px -10px rgba(0,0,0,.7);--sh-pop:0 28px 56px -18px rgba(0,0,0,.85);
  --ring:0 0 0 4px rgba(125,147,255,.3);
`;
const TOKENS = `
:root{${LIGHT}
  --r:12px;--r-sm:8px;--r-lg:18px;
  --ease:cubic-bezier(.22,.8,.24,1);--ease-in:cubic-bezier(.4,0,1,1);
  --font:"Noto Sans PP","Segoe UI",system-ui,-apple-system,"Yu Gothic UI","Meiryo",sans-serif;
  --mono:"JetBrains Mono",Consolas,"SFMono-Regular",monospace;
  color-scheme:light;
}
:root[data-theme="dark"]{${DARK}color-scheme:dark}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${DARK}color-scheme:dark}}
`;

// --- Nền, chữ ---
const BASE = `
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;scroll-behavior:smooth;scrollbar-gutter:stable}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 var(--font);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;min-height:100vh;font-variant-numeric:tabular-nums}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline;text-underline-offset:3px}
h1{font-size:28px;font-weight:700;letter-spacing:-.025em;margin:0;line-height:1.2}
h2{font-size:13px;font-weight:600;margin:0 0 10px;color:var(--ink-2)}
h3{font-size:15px;font-weight:600;margin:0}
p{margin:0 0 8px}
.muted{color:var(--ink-3)}.small{font-size:12.5px}.mono{font-family:var(--mono);font-size:12.5px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
:focus-visible{outline:none;box-shadow:var(--ring);border-radius:8px}
::selection{background:var(--brand);color:var(--brand-ink)}
.ico{width:18px;height:18px;flex:none}
.hidden{display:none}.grow{flex:1}.sep{flex:1}.right{text-align:right}.nowrap{white-space:nowrap}.strong{font-weight:600;color:var(--ink)}
.inline{display:inline}.inline form{display:inline}
kbd,.kbd{font:600 11px/1 var(--font);padding:3px 6px;border-radius:5px;background:var(--sunken);border:1px solid var(--line-2);border-bottom-width:2px;color:var(--ink-3)}
`;

// --- Khung: thanh bên tối, thanh đầu kính mờ, nội dung ---
const SHELL = `
.shell{display:grid;grid-template-columns:var(--rail-w,256px) minmax(0,1fr);min-height:100vh;transition:grid-template-columns .28s var(--ease)}
html[data-rail="mini"] .shell{--rail-w:76px}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;background:var(--rail);color:var(--rail-ink);padding:18px 14px 14px;overflow-x:hidden;overflow-y:auto;scrollbar-width:none;z-index:40;view-transition-name:rail}
.side::-webkit-scrollbar{display:none}
.side::before{content:"";position:absolute;inset:0;background:radial-gradient(120% 60% at 0% 0%,rgba(79,110,255,.22),transparent 60%);pointer-events:none}
.brand{position:relative;display:flex;align-items:center;gap:12px;padding:4px 8px 18px;color:#fff;white-space:nowrap}
.brand:hover{text-decoration:none}
.logo{width:34px;height:34px;flex:none;display:block;border-radius:10px}
.brand-t{font-weight:700;font-size:16px;letter-spacing:-.02em}.brand-t b{color:var(--rail-accent);font-weight:700}
.nav{position:relative;flex:1;display:flex;flex-direction:column;gap:2px}
.nav-g{font-size:11.5px;font-weight:600;color:var(--rail-ink-2);padding:20px 12px 7px;white-space:nowrap}
.nav-i{position:relative;display:flex;align-items:center;gap:13px;padding:9px 12px;border-radius:10px;color:var(--rail-ink);font-weight:500;white-space:nowrap;transition:background .18s var(--ease),color .18s var(--ease),transform .18s var(--ease)}
.nav-i .ico{opacity:.85;transition:transform .25s var(--ease),opacity .18s}
.nav-i:hover{background:rgba(255,255,255,.06);color:#fff;text-decoration:none}
.nav-i:hover .ico{opacity:1;transform:translateX(2px)}
.nav-i.on{background:linear-gradient(90deg,rgba(143,164,255,.2),rgba(143,164,255,.05));color:#fff;font-weight:600}
.nav-i.on .ico{opacity:1;color:var(--rail-accent)}
.nav-ind{position:absolute;left:-14px;top:9px;bottom:9px;width:4px;border-radius:0 4px 4px 0;background:var(--rail-accent);box-shadow:0 0 14px 1px var(--brand-glow);view-transition-name:nav-ind}
.badge{margin-left:auto;min-width:24px;height:20px;padding:0 7px;border-radius:999px;background:var(--brand);color:#fff;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.side-f{position:relative;display:flex;align-items:center;gap:11px;border-top:1px solid var(--rail-line);padding:14px 6px 0;margin-top:12px}
.avatar{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#5a73ff,#8b5cf6);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex:none}
.who{min-width:0;color:inherit;flex:1}.who:hover{text-decoration:none}
.who-n{font-weight:600;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff}
.who-r{font-size:12px;color:var(--rail-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
html[data-rail="mini"] .nav-i{justify-content:center;padding:11px 0}
html[data-rail="mini"] .nav-i>span:not(.badge),html[data-rail="mini"] .brand-t,html[data-rail="mini"] .nav-g,html[data-rail="mini"] .who{display:none}
html[data-rail="mini"] .badge{position:absolute;top:2px;right:6px;min-width:18px;height:16px;font-size:10px;padding:0 4px}
html[data-rail="mini"] .brand{justify-content:center;padding-inline:0}
html[data-rail="mini"] .side-f{justify-content:center}
html[data-rail="mini"] .nav-ind{left:-14px}

.content{min-width:0;display:flex;flex-direction:column;min-height:100vh}
.topbar{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:10px;height:62px;padding:0 clamp(16px,2.6vw,36px);background:color-mix(in srgb,var(--bg) 78%,transparent);backdrop-filter:saturate(1.6) blur(14px);-webkit-backdrop-filter:saturate(1.6) blur(14px);border-bottom:1px solid transparent;transition:border-color .2s,box-shadow .2s;view-transition-name:topbar}
.topbar.is-scrolled{border-bottom-color:var(--line);box-shadow:0 8px 24px -16px rgba(14,22,40,.25)}
.topbar-title{font-weight:600;color:var(--ink-2);font-size:14px}
.rail-toggle{display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--ink-2);cursor:pointer;transition:background .15s,transform .15s var(--ease)}
.rail-toggle:hover{background:var(--surface-2);transform:scale(1.05)}
.cmdk-trigger{display:flex;align-items:center;gap:10px;height:38px;min-width:min(320px,34vw);padding:0 10px 0 12px;border:1px solid var(--line);background:var(--surface);border-radius:10px;color:var(--ink-4);font:inherit;font-size:13.5px;cursor:pointer;transition:border-color .15s,box-shadow .15s}
.cmdk-trigger:hover{border-color:var(--line-2);box-shadow:var(--sh-1)}
.cmdk-trigger .kbd{margin-left:auto}
.theme{display:inline-flex;padding:3px;background:var(--surface);border:1px solid var(--line);border-radius:999px;gap:2px}
.theme button{border:0;background:transparent;color:var(--ink-3);font:inherit;font-size:12.5px;font-weight:600;padding:6px 9px;border-radius:999px;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background .18s,color .18s}
.theme button:hover{color:var(--ink)}
.theme button[aria-pressed="true"]{background:var(--ink);color:var(--surface)}
.theme .lbl{display:none}
.iconbtn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:38px;height:38px;border-radius:10px;color:var(--ink-2);border:1px solid var(--line);background:var(--surface);transition:background .15s,transform .15s var(--ease)}
.iconbtn:hover{background:var(--surface-2);text-decoration:none;transform:translateY(-1px)}
.iconbtn .dot{position:absolute;top:7px;right:8px;width:8px;height:8px;border-radius:50%;background:var(--bad);border:2px solid var(--surface);animation:pulse 2s infinite}
.usermenu{position:relative}
.usermenu summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:9px;padding:3px 10px 3px 3px;border-radius:999px;border:1px solid var(--line);background:var(--surface);transition:box-shadow .15s}
.usermenu summary::-webkit-details-marker{display:none}
.usermenu summary:hover{box-shadow:var(--sh-1)}
.usermenu .avatar{width:30px;height:30px;font-size:11px}
.usermenu .nm{font-size:13px;font-weight:600;color:var(--ink);max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.menu{position:absolute;right:0;top:calc(100% + 10px);min-width:230px;background:var(--surface);border:1px solid var(--line);border-radius:14px;box-shadow:var(--sh-pop);padding:6px;z-index:50;animation:pop .2s var(--ease)}
.menu a,.menu button{display:flex;width:100%;align-items:center;gap:10px;padding:10px 11px;border-radius:9px;color:var(--ink-2);font:inherit;text-align:left;background:none;border:0;cursor:pointer}
.menu a:hover,.menu button:hover{background:var(--sunken);color:var(--ink);text-decoration:none}
.menu hr{border:0;border-top:1px solid var(--line);margin:6px 0}
.banner{background:var(--bad-soft);color:var(--bad-ink);border-bottom:1px solid color-mix(in srgb,var(--bad) 30%,transparent);padding:11px clamp(16px,2.6vw,36px);font-size:13.5px}
.main{width:100%;max-width:1560px;margin:0 auto;padding:10px clamp(16px,2.6vw,36px) 56px;flex:1}
.page{display:block;min-width:0}
.cols>*,.split>*,.hero>*,.kpis>*{min-width:0}
.row-gap .small{white-space:nowrap}
.page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:14px 0 24px;flex-wrap:wrap}
.page-head .sub{color:var(--ink-3);margin-top:6px;max-width:760px;font-size:14px}
.crumb{font-size:12.5px;color:var(--ink-3);margin-bottom:8px;font-weight:500}
.footer{padding:16px clamp(16px,2.6vw,36px);display:flex;align-items:center;gap:18px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-3)}
.footer a{color:var(--ink-3)}
.footer .sep-dot{width:3px;height:3px;border-radius:50%;background:var(--ink-4)}
.live{display:inline-flex;align-items:center;gap:7px}
.live::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ok);animation:pulse 2.4s infinite}
.scrim{display:none}
`;

// --- Khối nội dung, chỉ số, tiêu điểm ---
const SURFACES = `
.panel{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);margin-bottom:18px;overflow:hidden}
.panel-h{padding:15px 20px;border-bottom:1px solid var(--line);font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:14px}
.panel-h .small{font-weight:400}
.panel-b{padding:20px}
.table-wrap{background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);overflow:auto}
.empty{padding:44px 20px;text-align:center;color:var(--ink-3)}
.grid-cards{display:grid;gap:16px}
.split{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:24px;align-items:start}
.cols{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:20px;margin-bottom:20px;align-items:start}

/* tiêu điểm đầu trang tổng quan */
.hero{position:relative;overflow:hidden;border-radius:var(--r-lg);padding:30px 32px;margin-bottom:20px;color:#fff;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:28px;align-items:center;background:radial-gradient(90% 140% at 100% 0%,rgba(70,100,255,.65),transparent 60%),radial-gradient(70% 100% at 0% 100%,rgba(139,92,246,.35),transparent 60%),linear-gradient(135deg,#0b1220,#111c38)}
.hero::after{content:"";position:absolute;inset:0;pointer-events:none;background-image:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px);background-size:34px 34px;-webkit-mask-image:radial-gradient(70% 120% at 100% 0%,#000,transparent 75%);mask-image:radial-gradient(70% 120% at 100% 0%,#000,transparent 75%)}
.hero>*{position:relative;z-index:1}
.hero-k{font-size:13px;color:rgba(255,255,255,.72);font-weight:500}
.hero-v{font-size:clamp(46px,6vw,72px);font-weight:700;letter-spacing:-.04em;line-height:1;margin:10px 0 8px}
.hero-v small{font-size:20px;font-weight:500;letter-spacing:0;color:rgba(255,255,255,.7);margin-left:8px}
.hero-s{color:rgba(255,255,255,.78);max-width:440px;font-size:14px}
.hero-s b{color:#fff}
.hero-act{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}
.hero .btn{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.22);color:#fff;box-shadow:none}
.hero .btn:hover{background:rgba(255,255,255,.18)}
.hero .btn.primary{background:#fff;color:#0b1220;border-color:#fff}
.hero .btn.primary:hover{background:#e9eeff}
.todo{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.todo li{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 15px;border-radius:12px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.08);backdrop-filter:blur(8px);font-size:14px;color:#fff;border-left:3px solid rgba(255,255,255,.4);transition:transform .2s var(--ease),background .2s}
.todo li:hover{transform:translateX(3px);background:rgba(255,255,255,.12)}
.todo li.todo-bad{border-left-color:#ff7a86}
.todo li.todo-warn{border-left-color:#ffc35a}
.todo li.todo-info{border-left-color:#7fb4ff}
.todo .btn{flex:none;height:32px;font-size:12.5px}
.todo-panel{margin-bottom:20px}
.hero .empty{color:rgba(255,255,255,.7);padding:24px 0;text-align:left}

/* chỉ số */
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:20px}
.kpi{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:18px 20px;box-shadow:var(--sh-1);overflow:hidden;transition:transform .25s var(--ease),box-shadow .25s var(--ease),border-color .25s}
.kpi:hover{transform:translateY(-3px);box-shadow:var(--sh-2);border-color:var(--line-2)}
.kpi::before{content:"";position:absolute;left:0;top:0;right:0;height:3px;background:var(--ink-4);opacity:.5}
.kpi:has(.c-warn)::before{background:var(--warn);opacity:1}.kpi:has(.c-ok)::before{background:var(--ok);opacity:1}.kpi:has(.c-info)::before{background:var(--brand);opacity:1}
.kpi-l{font-size:13px;color:var(--ink-3);font-weight:500;display:flex;align-items:center;gap:8px}
.kpi-l i{width:8px;height:8px;border-radius:50%;background:var(--ink-4);display:inline-block}
.kpi-l i.c-warn{background:var(--warn)}.kpi-l i.c-info{background:var(--brand)}.kpi-l i.c-ok{background:var(--ok)}.kpi-l i.c-mute{background:var(--ink-4)}
.kpi-v{font-size:36px;font-weight:700;line-height:1.05;margin:12px 0 8px;letter-spacing:-.03em}
.kpi-v small{font-size:13px;color:var(--ink-3);font-weight:500;margin-left:6px;letter-spacing:0}
.kpi-s{font-size:12.5px;color:var(--ink-3)}
.kpi-s .up{color:var(--bad-ink);font-weight:600}
.hbar{height:6px;border-radius:999px;background:var(--sunken);overflow:hidden;margin-top:10px}.hbar span{display:block;height:100%;background:var(--brand);border-radius:999px}
.verdicts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-bottom:20px}
.verdict{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);padding:20px 22px 20px 26px;overflow:hidden}
.verdict::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--ink-4)}
.verdict.ok::before{background:var(--ok)}.verdict.bad::before{background:var(--bad)}
.verdict-h{display:flex;align-items:center;gap:8px;color:var(--ink-3);font-size:13px}
.verdict-dot{width:8px;height:8px;border-radius:50%;background:var(--ink-4)}
.verdict.ok .verdict-dot{background:var(--ok);animation:pulse 2.4s infinite}.verdict.bad .verdict-dot{background:var(--bad)}
.verdict-v{font-size:26px;font-weight:700;letter-spacing:-.03em;margin:8px 0 4px}

/* biểu đồ bằng CSS */
.stack{display:flex;height:12px;border-radius:999px;overflow:hidden;background:var(--sunken);margin:4px 0 18px;gap:2px}
.stack span{display:block;height:100%;transform-origin:left;animation:grow-x .8s var(--ease) both}
.legend{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px;font-size:13px}
.legend div{display:flex;align-items:center;gap:9px}
.legend i{width:9px;height:9px;border-radius:3px;flex:none}
.legend b{margin-left:auto;font-weight:600}
.bars{display:grid;grid-template-columns:repeat(7,1fr);gap:12px;height:170px;align-items:end;padding-top:8px}
.bar{display:flex;flex-direction:column;justify-content:flex-end;height:100%;align-items:center;gap:6px}
.bar-col{width:100%;max-width:40px;flex:1;display:flex;flex-direction:column;justify-content:flex-end;gap:2px}
.bar-col span{display:block;border-radius:7px 7px 3px 3px;min-height:0;transform-origin:bottom;animation:grow-y .7s var(--ease) both}
.bar-l{font-size:11.5px;color:var(--ink-3)}
.bar-n{font-size:11.5px;font-weight:600;color:var(--ink-2);height:14px}
.key{display:flex;gap:16px;font-size:12.5px;color:var(--ink-3);margin-top:14px;flex-wrap:wrap}
.key i{display:inline-block;width:9px;height:9px;border-radius:3px;margin-right:6px}
.c-ok-bg{background:var(--ok)}.c-mute-bg{background:var(--line-2)}.c-info-bg{background:var(--brand)}.c-warn-bg{background:var(--warn)}.c-bad-bg{background:var(--bad)}.c-ink-bg{background:var(--ink-4)}
.daybars{display:flex;gap:6px;align-items:flex-end;height:180px;overflow-x:auto;padding-bottom:2px}
.dayb{flex:1;min-width:24px;height:100%;display:flex;flex-direction:column;align-items:center}
.dayb-col{flex:1;width:100%;max-width:34px;display:flex;align-items:flex-end;background:var(--sunken);border-radius:7px;overflow:hidden}
.dayb-col span{display:block;width:100%;background:linear-gradient(180deg,var(--brand-2),var(--brand));border-radius:7px 7px 3px 3px;transform-origin:bottom;animation:grow-y .7s var(--ease) both}
.dayb-l{font-size:11px;color:var(--ink-3);margin-top:6px}
.meter{height:8px;border-radius:99px;background:var(--sunken);overflow:hidden;margin:6px 0 8px;min-width:120px}
.meter span{display:block;height:100%;border-radius:99px;transform-origin:left;animation:grow-x .9s var(--ease) both}
.bar-con{background:var(--ok)}.bar-sap-het{background:var(--warn)}.bar-het{background:var(--bad)}.bar-chua-ro{background:var(--ink-4)}
`;

// --- Bảng, nhãn, vòng điểm ---
const DATA = `
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:14px 16px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:12px;font-weight:600;color:var(--ink-3);background:var(--surface-2);white-space:nowrap;position:sticky;top:0;z-index:1}
tbody tr{transition:background .15s}
tbody tr:hover td{background:var(--surface-2)}
tr:last-child td{border-bottom:0}
td.title{min-width:280px}
td.title a{color:var(--ink);font-weight:600;font-size:14.5px;line-height:1.45}
td.title a:hover{color:var(--brand);text-decoration:none}
.col-title{width:46%}
.row-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;margin-top:5px;font-size:12px}
.tags{display:flex;gap:6px;flex-wrap:wrap}
td.title .tags{margin-top:7px}
tr.r-high td:first-child{box-shadow:inset 4px 0 0 var(--bad)}
tr.r-med td:first-child{box-shadow:inset 4px 0 0 var(--warn)}
tr.is-focus td{background:var(--brand-soft)}
tr.is-focus td:first-child{box-shadow:inset 4px 0 0 var(--brand)}
.chk{width:42px;text-align:center}
.split-t{width:100%;border-collapse:collapse}
.split-t th,.split-t td{padding:10px 0;border-bottom:1px solid var(--line);background:none;font-size:13px;position:static}
.split-t th{text-align:left;color:var(--ink-3)}.split-t td:not(:first-child),.split-t th:not(:first-child){text-align:right}
.split-t tr:last-child td{border-bottom:0}
table.users td{vertical-align:middle}

.status{display:inline-flex;align-items:center;gap:7px;white-space:nowrap;font-weight:600;font-size:12.5px;padding:3px 10px 3px 8px;border-radius:999px;background:var(--sunken);color:var(--ink-2)}
.status::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--ink-4)}
.status.ok{background:var(--ok-soft);color:var(--ok-ink)}.status.ok::before{background:var(--ok)}
.status.warn{background:var(--warn-soft);color:var(--warn-ink)}.status.warn::before{background:var(--warn)}
.status.bad{background:var(--bad-soft);color:var(--bad-ink)}.status.bad::before{background:var(--bad)}
.status.info{background:var(--brand-soft);color:var(--brand-2)}.status.info::before{background:var(--brand);animation:pulse 1.8s infinite}
.tag{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:6px;padding:1px 8px;font-size:11.5px;font-weight:600;color:var(--ink-2);line-height:19px;background:var(--surface-2)}
.tag.risk-high{background:var(--bad-soft);color:var(--bad-ink);border-color:transparent}
.tag.risk-medium{background:var(--warn-soft);color:var(--warn-ink);border-color:transparent}
.tag.bad-tag{color:var(--bad-ink);border-color:transparent;background:var(--bad-soft);margin-left:6px}
.chip{display:inline-flex;align-items:center;padding:2px 10px;border-radius:999px;background:var(--sunken);font-size:12px;color:var(--ink-2)}
.warn-t{color:var(--warn-ink);font-weight:600;font-size:12.5px;white-space:nowrap}
.qchip{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;cursor:help}
.qchip.q-good{background:var(--ok-soft);color:var(--ok-ink)}.qchip.q-ok{background:var(--warn-soft);color:var(--warn-ink)}.qchip.q-low{background:var(--bad-soft);color:var(--bad-ink)}
.ring{--rc:var(--ink-4);position:relative;display:inline-grid;place-items:center;width:42px;height:42px;border-radius:50%;background:conic-gradient(var(--rc) calc(var(--p) * 1%),var(--sunken) 0);cursor:help;animation:ringin 1s var(--ease) both}
.ring::before{content:"";position:absolute;inset:5px;border-radius:50%;background:var(--surface)}
.ring b{position:relative;font-size:12px;font-weight:700;letter-spacing:-.02em}
.ring.q-good{--rc:var(--ok)}.ring.q-ok{--rc:var(--warn)}.ring.q-low{--rc:var(--bad)}
@keyframes ringin{from{--p:0}}
.list{list-style:none;margin:0;padding:0}
.list li{display:flex;gap:14px;padding:12px 0;border-bottom:1px solid var(--line)}
.list li:last-child{border-bottom:0;padding-bottom:0}.list li:first-child{padding-top:0}
.list .when{flex:0 0 108px;font-size:12.5px;color:var(--ink-3)}
.list .what{min-width:0;display:flex;flex-direction:column;gap:2px}
.list .what a,.list .what span:first-child{color:var(--ink);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.list .what a:hover{color:var(--brand)}
.checks{list-style:none;margin:0;padding:0}
.checks li{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13.5px;align-items:flex-start}
.checks li:last-child{border-bottom:0}
.checks .k{flex:0 0 20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px}
.checks .pass .k{background:var(--ok-soft);color:var(--ok-ink)}.checks .fail .k{background:var(--bad-soft);color:var(--bad-ink)}.checks .note .k{background:var(--warn-soft);color:var(--warn-ink)}
.timeline{list-style:none;margin:0;padding:0}
.timeline li{padding:0 0 18px 20px;border-left:2px solid var(--line);margin-left:5px;position:relative}
.timeline li::before{content:"";position:absolute;left:-7px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--surface);border:3px solid var(--brand)}
.timeline li:last-child{padding-bottom:0}
.timeline .who{font-weight:600;color:var(--ink)}
ol.claims{margin:0 0 12px;padding-left:20px}ol.claims li{margin-bottom:7px}
.rules{margin:0;padding-left:20px;line-height:1.8;color:var(--ink-2)}
.facts{display:grid;grid-template-columns:118px 1fr;gap:11px 14px;margin:0;font-size:13.5px}
.facts dt{color:var(--ink-3)}.facts dd{margin:0;word-break:break-word}
.q-list{margin:6px 0 0;padding-left:18px}.q-list li{margin-bottom:4px}.q-list li.bad{color:var(--bad-ink)}.q-list li.warn{color:var(--warn-ink)}
.errlist{margin:6px 0 0;padding-left:20px}
.sub-h{font-size:13px;font-weight:600;color:var(--ink-2);margin:20px 0 8px}
`;

// --- Nút, biểu mẫu ---
const FORMS = `
.btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;padding:0 16px;border:1px solid var(--line-2);background:var(--surface);color:var(--ink);border-radius:10px;font:inherit;font-weight:600;font-size:13.5px;cursor:pointer;text-decoration:none;white-space:nowrap;box-shadow:var(--sh-1);transition:background .18s,border-color .18s,transform .18s var(--ease),box-shadow .18s}
.btn:hover{background:var(--surface-2);text-decoration:none;border-color:var(--ink-4);transform:translateY(-1px);box-shadow:var(--sh-2)}
.btn:active{transform:translateY(0) scale(.98);box-shadow:none}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none;box-shadow:none}
.btn.primary{background:linear-gradient(180deg,color-mix(in srgb,var(--brand) 88%,#fff),var(--brand));border-color:var(--brand-2);color:var(--brand-ink);box-shadow:0 1px 0 rgba(255,255,255,.22) inset,0 8px 18px -8px var(--brand-glow)}
.btn.primary:hover{filter:brightness(1.07);background:linear-gradient(180deg,color-mix(in srgb,var(--brand) 88%,#fff),var(--brand))}
.btn.danger{color:var(--bad-ink);border-color:color-mix(in srgb,var(--bad) 40%,transparent)}
.btn.danger:hover{background:var(--bad-soft);border-color:var(--bad)}
.btn.ghost{background:transparent;border-color:transparent;box-shadow:none;color:var(--ink-2)}
.btn.ghost:hover{background:var(--sunken);box-shadow:none}
.btn.sm{height:30px;padding:0 11px;font-size:12.5px;border-radius:8px}
.btn.lg{height:46px;padding:0 22px;font-size:15px;border-radius:12px}
.btn.block{width:100%}
.btn.link{border:0;background:none;box-shadow:none;height:auto;padding:0;color:var(--brand)}
.btn.is-loading{color:transparent!important;pointer-events:none}
.btn.is-loading::after{content:"";position:absolute;width:16px;height:16px;border-radius:50%;border:2px solid currentColor;border-color:rgba(127,127,127,.35);border-top-color:var(--ink);animation:spin .7s linear infinite}
.btn.primary.is-loading::after{border-color:rgba(255,255,255,.35);border-top-color:#fff}
.btn-row,.actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tbl-act{display:flex;gap:6px;justify-content:flex-end;flex-wrap:nowrap;align-items:center}
label{display:block;font-weight:600;font-size:13px;margin:0 0 6px;color:var(--ink-2)}
.field{margin-bottom:18px;min-width:0}
.field.full,.form-grid .field.full,.form-grid .savebar,.savebar{grid-column:1/-1}
.hint{font-size:12.5px;color:var(--ink-3);margin-top:6px}
input[type=text],input[type=email],input[type=password],input[type=datetime-local],input[type=date],input[type=number],input[type=time],input[type=url],input[type=search],textarea,select{width:100%;height:40px;padding:0 13px;border:1px solid var(--line-2);border-radius:10px;background:var(--surface);color:var(--ink);font:inherit;font-size:14px;transition:border-color .18s,box-shadow .18s,background .18s;appearance:auto}
textarea{height:auto;padding:11px 13px;min-height:96px;resize:vertical;line-height:1.65}
textarea.tall{min-height:260px}
select{padding-right:8px}
input::placeholder,textarea::placeholder{color:var(--ink-4)}
input:hover,textarea:hover,select:hover{border-color:var(--ink-4)}
input:focus,textarea:focus,select:focus,input:focus-visible{outline:none;border-color:var(--brand);box-shadow:var(--ring)}
input:disabled,textarea:disabled,select:disabled{opacity:.6;background:var(--sunken)}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 22px}
.check{display:flex;gap:10px;align-items:flex-start;font-weight:400;margin:0 0 8px;color:var(--ink-2);cursor:pointer}
.check input{width:17px;height:17px;margin-top:2px;accent-color:var(--brand)}
.savebar{display:flex;justify-content:flex-end;gap:10px;padding-top:6px;align-items:center}
.inline-label{display:flex;gap:8px;align-items:center;font-weight:600;font-size:13px;color:var(--ink-2)}
.toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.toolbar form{display:flex;gap:8px;align-items:center;margin:0;flex-wrap:wrap}
.toolbar input[type=search]{width:300px}
.toolbar select{width:auto;min-width:110px;height:38px}
.toolbar-form{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0}
.toolbar-form select{width:auto;min-width:120px}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:2px}
.chip-check{position:relative;display:inline-flex;align-items:center;margin:0;cursor:pointer;font-weight:500;color:var(--ink-2)}
.chip-check input{position:absolute;opacity:0;width:0;height:0}
.chip-check span{padding:8px 15px;border:1px solid var(--line-2);border-radius:999px;background:var(--surface);font-size:13px;transition:all .18s var(--ease)}
.chip-check:hover span{border-color:var(--ink-4);transform:translateY(-1px)}
.chip-check input:checked+span{background:var(--brand-soft);border-color:var(--brand);color:var(--brand-2);font-weight:600}
.chip-check input:focus-visible+span{box-shadow:var(--ring)}
.filters{display:flex;gap:12px 16px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.seg{display:inline-flex;background:var(--sunken);border-radius:11px;padding:4px;gap:2px;flex-wrap:wrap}
.seg a{padding:7px 13px;color:var(--ink-3);border-radius:8px;font-size:13px;font-weight:500;white-space:nowrap;transition:background .18s,color .18s}
.seg a:hover{color:var(--ink);text-decoration:none}
.seg a.on{background:var(--surface);color:var(--ink);box-shadow:var(--sh-1);font-weight:600}
.seg .n{display:inline-block;margin-left:6px;font-size:11.5px;color:var(--ink-3)}
.pager{display:flex;align-items:center;justify-content:center;gap:14px;margin:20px 0 8px;flex-wrap:wrap}
.pager .btn[aria-disabled="true"]{opacity:.45;pointer-events:none}
.bulk-bar{position:sticky;bottom:16px;z-index:5;box-shadow:var(--sh-pop);display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 14px;margin-top:12px;border:1px solid var(--line);border-radius:14px;background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:blur(12px)}
.bulk-bar input[type=text]{min-width:220px;flex:1}
.gen-panel{border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;margin:0 0 16px;background:var(--surface);display:flex;flex-direction:column;gap:8px;box-shadow:var(--sh-1)}
.gen-panel.running{border-color:var(--brand)}.gen-panel.error{border-color:var(--bad)}
.secret{background:var(--warn-soft);border:1px solid color-mix(in srgb,var(--warn) 30%,transparent);border-radius:var(--r);padding:16px 18px;margin:0 0 18px}
.secret code{font-family:var(--mono);font-size:14px;background:var(--surface);padding:3px 9px;border:1px solid var(--line);border-radius:6px;user-select:all}
.day{margin-bottom:28px}
.day-h{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.day-h h2{font-size:16px;font-weight:600;margin:0;text-transform:capitalize;color:var(--ink)}
.slot{display:grid;grid-template-columns:110px minmax(0,1fr) 170px;gap:16px;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-sm);padding:13px 18px;margin-bottom:8px;box-shadow:var(--sh-1);transition:transform .2s var(--ease),box-shadow .2s}
.slot:hover{transform:translateX(3px);box-shadow:var(--sh-2)}
.slot .t{font-weight:700;font-size:15px}
.slot .h{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.slot .h a{color:var(--ink);font-weight:500}.slot .h a:hover{color:var(--brand)}
details.more{border-top:1px solid var(--line);padding-top:12px;margin-top:14px}
details.more>summary{cursor:pointer;font-weight:600;color:var(--ink-2);margin-bottom:10px;list-style:none}
details.more>summary::-webkit-details-marker{display:none}
details.more>summary::before{content:"▸ ";color:var(--ink-3)}
details[open].more>summary::before{content:"▾ "}
details.fold>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px;transition:background .15s}
details.fold>summary:hover{background:var(--surface-2)}
details.fold>summary::-webkit-details-marker{display:none}
details.fold>summary::after{content:"";width:8px;height:8px;border-right:2px solid var(--ink-3);border-bottom:2px solid var(--ink-3);transform:rotate(45deg);margin:-4px 2px 0 auto;flex:none;transition:transform .25s var(--ease)}
details.fold[open]>summary::after{transform:rotate(-135deg);margin-top:4px}
details.fold>summary:focus-visible{outline:2px solid var(--brand);outline-offset:-2px}
details.fold[open]>summary{border-bottom:1px solid var(--line)}
.fold-group{margin-bottom:18px}
.fold-group>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 18px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-1);font-size:13.5px;font-weight:600;color:var(--ink-2)}
.fold-group>summary::-webkit-details-marker{display:none}
.fold-group>summary::after{content:"";width:8px;height:8px;border-right:2px solid var(--ink-3);border-bottom:2px solid var(--ink-3);transform:rotate(45deg);margin-top:-4px;flex:none;transition:transform .25s var(--ease)}
.fold-group[open]>summary{margin-bottom:18px}
.fold-group[open]>summary::after{transform:rotate(-135deg);margin-top:4px}
.fold-group>summary:focus-visible{outline:2px solid var(--brand);outline-offset:2px}
.side-sticky{padding:2px}
`;

// --- Thông báo, xem trước bài, video, đề xuất ---
const WIDGETS = `
.notice{display:flex;gap:11px;align-items:flex-start;border:1px solid var(--line);border-radius:var(--r-sm);padding:13px 15px;margin-bottom:18px;background:var(--surface);color:var(--ink-2);font-size:13.5px;box-shadow:var(--sh-1)}
.notice::before{content:"";width:8px;height:8px;border-radius:50%;margin-top:6px;flex:none;background:var(--ink-4)}
.notice.ok{background:var(--ok-soft);border-color:color-mix(in srgb,var(--ok) 28%,transparent);color:var(--ink)}.notice.ok::before{background:var(--ok)}
.notice.err{background:var(--bad-soft);border-color:color-mix(in srgb,var(--bad) 28%,transparent);color:var(--ink)}.notice.err::before{background:var(--bad)}
.notice.warn{background:var(--warn-soft);border-color:color-mix(in srgb,var(--warn) 28%,transparent);color:var(--ink)}.notice.warn::before{background:var(--warn)}
.toasts{position:fixed;top:74px;right:20px;z-index:80;display:flex;flex-direction:column;gap:10px;pointer-events:none;max-width:min(420px,calc(100vw - 32px))}
.toast{pointer-events:auto;margin:0;box-shadow:var(--sh-pop);animation:toast-in .4s var(--ease) both}
.toast.is-out{animation:toast-out .3s var(--ease-in) both}

.fb{border:1px solid var(--line);border-radius:14px;background:var(--surface);max-width:600px;box-shadow:var(--sh-2)}
.fb-h{display:flex;gap:11px;align-items:center;padding:15px 18px}
.fb-av{width:42px;height:42px;border-radius:50%;background:linear-gradient(135deg,#5a73ff,#8b5cf6);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px}
.fb-name{font-weight:600;line-height:1.2}.fb-sub{font-size:12px;color:var(--ink-3)}
.fb-body{padding:0 18px 16px;white-space:pre-wrap;word-break:break-word;font-size:15px;line-height:1.7}
.fb-body .hl{font-weight:700;display:block;margin-bottom:8px;font-size:16px}
.fb-tags{color:var(--brand);margin-top:10px;display:block}
.fb-card{margin:0 18px 18px;border:1px solid var(--line);border-radius:var(--r-sm);padding:16px;background:var(--surface-2)}
.fb-card b{display:block;margin-bottom:6px}.fb-card ul{margin:0;padding-left:18px}
.card-prev{margin-top:18px;text-align:center}
.card-prev img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:var(--r);box-shadow:var(--sh-2)}
.card-prev .small{margin-top:8px}
.reel-prev{display:block;margin:0 auto;width:270px;max-width:100%;aspect-ratio:9/16;background:#000;border-radius:var(--r);border:1px solid var(--line);box-shadow:var(--sh-2)}
.row-gap{display:flex;align-items:center;gap:12px}
.reel-progress{margin:0 0 14px;padding:14px 16px;border:1px solid var(--line);border-radius:var(--r);background:var(--sunken)}
.reel-progress.compact{margin:0;padding:0;border:0;background:none;min-width:200px}
.reel-bar{display:block;width:100%;height:10px;border:0;border-radius:99px;overflow:hidden;appearance:none;-webkit-appearance:none;background:var(--line)}
.reel-bar::-webkit-progress-bar{background:var(--line);border-radius:99px}
.reel-bar::-webkit-progress-value{background:linear-gradient(90deg,var(--brand-2),var(--brand));border-radius:99px;transition:width .5s var(--ease)}
.reel-bar::-moz-progress-bar{background:var(--brand);border-radius:99px}
.reel-progress.compact .reel-bar{height:6px}
.reel-meta{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px;font-size:13px;color:var(--ink-2)}
.reel-meta b{color:var(--ink)}
.reel-row{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
.reel-row .btn{height:32px;padding:0 12px;font-size:13px}
.studio-wrap{position:relative;border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:#1e1e1e;box-shadow:var(--sh-2)}
.studio-wrap::before{content:"Đang tải Remotion Studio…";position:absolute;inset:0;display:grid;place-items:center;color:#9ca3af;font-size:14px}
.studio-frame{position:relative;display:block;width:100%;height:calc(100vh - 230px);min-height:620px;border:0;background:transparent}
.studio-foot{margin:10px 2px 0}
.diff-b{margin-bottom:14px}
.diff{font-family:var(--mono);font-size:12.5px;border:1px solid var(--line);border-radius:var(--r-sm);overflow:hidden;margin-top:6px;background:var(--surface-2)}
.diff div{padding:5px 13px;white-space:pre-wrap;word-break:break-word}
.d-add{background:var(--ok-soft);color:var(--ok-ink)}.d-del{background:var(--bad-soft);color:var(--bad-ink)}.d-eq{color:var(--ink-3)}
.topics{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
.topic{border:1px solid var(--line);border-radius:var(--r);padding:18px;display:flex;flex-direction:column;gap:9px;background:var(--surface);box-shadow:var(--sh-1);transition:transform .25s var(--ease),box-shadow .25s,border-color .25s}
.topic:hover{border-color:var(--brand-line);transform:translateY(-3px);box-shadow:var(--sh-2)}
.topic h3{font-size:15px;line-height:1.45}
.topic form{margin-top:auto;padding-top:10px}
.topic-src{margin:0;padding-left:18px;line-height:1.65}
.steps{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap}
.step{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--ink-3);font-weight:600}
.step b{width:26px;height:26px;border-radius:50%;background:var(--sunken);color:var(--ink-2);display:inline-flex;align-items:center;justify-content:center;font-size:12px}
.step.on{color:var(--ink)}.step.on b{background:var(--brand);color:var(--brand-ink)}

/* bảng lệnh nhanh (Ctrl+K) */
.cmdk{position:fixed;inset:0;z-index:100;display:none;align-items:flex-start;justify-content:center;padding:12vh 16px 16px;background:rgba(8,13,24,.55);backdrop-filter:blur(6px)}
.cmdk.is-open{display:flex;animation:fade .18s var(--ease)}
.cmdk-box{width:min(620px,100%);background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--sh-pop);overflow:hidden;animation:pop .25s var(--ease)}
.cmdk-in{display:flex;align-items:center;gap:12px;padding:0 18px;border-bottom:1px solid var(--line)}
.cmdk-in input{border:0;background:none;height:56px;font-size:16px;box-shadow:none!important;padding:0}
.cmdk-list{max-height:min(52vh,420px);overflow:auto;padding:8px}
.cmdk-g{font-size:11.5px;font-weight:600;color:var(--ink-4);padding:10px 12px 4px}
.cmdk-i{display:flex;align-items:center;gap:12px;padding:11px 12px;border-radius:10px;color:var(--ink);cursor:pointer;font-weight:500}
.cmdk-i .ico{color:var(--ink-3)}
.cmdk-i.is-sel{background:var(--brand-soft);color:var(--brand-2)}
.cmdk-i.is-sel .ico{color:var(--brand)}
.cmdk-i:hover{text-decoration:none}
.cmdk-i .kbd{margin-left:auto}
.cmdk-empty{padding:28px;text-align:center;color:var(--ink-3)}
.cmdk-foot{display:flex;gap:16px;padding:10px 16px;border-top:1px solid var(--line);font-size:12px;color:var(--ink-3);background:var(--surface-2)}
`;

// --- Màn đăng nhập ---
const AUTH = `
.auth{min-height:100vh;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);background:var(--bg)}
.auth-art{position:relative;overflow:hidden;color:#fff;padding:48px 56px;display:flex;flex-direction:column;background:#070b16}
.auth-art::before{content:"";position:absolute;inset:-20%;background:radial-gradient(40% 40% at 20% 25%,rgba(70,100,255,.75),transparent 70%),radial-gradient(35% 40% at 80% 30%,rgba(139,92,246,.6),transparent 70%),radial-gradient(45% 45% at 55% 85%,rgba(34,197,235,.4),transparent 70%);filter:blur(30px);animation:aurora 18s ease-in-out infinite alternate}
.auth-art::after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.06) 1px,transparent 1px);background-size:44px 44px;-webkit-mask-image:radial-gradient(80% 80% at 30% 40%,#000,transparent);mask-image:radial-gradient(80% 80% at 30% 40%,#000,transparent)}
.auth-art>*{position:relative;z-index:1}
.auth-art .orb{position:absolute;border-radius:50%;filter:blur(50px);opacity:.45;pointer-events:none;animation:float 14s ease-in-out infinite}
.auth-art .o1{width:340px;height:340px;background:#8fa4ff;top:-110px;right:-90px}
.auth-art .o2{width:260px;height:260px;background:#c4b5fd;bottom:-80px;left:-60px;animation-delay:-6s}
.auth-brand-lg{display:flex;align-items:center;gap:12px;font-size:19px;font-weight:700;letter-spacing:-.02em}
.auth-brand-lg b{color:var(--rail-accent)}
.auth-copy{margin:auto 0;max-width:540px;padding:32px 0}
.auth-copy h2{font-size:clamp(34px,4vw,50px);line-height:1.08;letter-spacing:-.035em;margin:0 0 18px;font-weight:700;color:#fff;animation:rise .8s var(--ease) both}
.auth-copy>p{font-size:16px;line-height:1.6;color:rgba(255,255,255,.8);margin:0 0 32px;max-width:470px;animation:rise .8s .1s var(--ease) both}
.auth-points{list-style:none;padding:0;margin:0;display:grid;gap:14px}
.auth-points li{display:flex;gap:13px;align-items:flex-start;font-size:14.5px;color:rgba(255,255,255,.92);padding:13px 15px;border-radius:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(10px);animation:rise .7s var(--ease) both}
.auth-points li:nth-child(1){animation-delay:.25s}.auth-points li:nth-child(2){animation-delay:.38s}.auth-points li:nth-child(3){animation-delay:.51s}
.auth-points .ck{flex:none;width:22px;height:22px;border-radius:50%;background:rgba(110,231,161,.2);display:grid;place-items:center;font-size:12px;font-weight:700;color:#6ee7a1}
.auth-art-foot{font-size:12px;color:rgba(255,255,255,.6)}
.auth-form{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px 28px}
.auth-form .theme{position:absolute;top:18px;right:18px}
.auth-card{width:100%;max-width:410px;animation:rise .7s .1s var(--ease) both}
.auth-card h1{font-size:30px;margin:0 0 8px;letter-spacing:-.03em}
.auth-card .sub{color:var(--ink-3);margin:0 0 28px;font-size:14.5px}
.auth-card .btn.block{width:100%;height:48px;font-size:15px;margin-top:8px}
.auth-help{font-size:12.5px;color:var(--ink-3);margin:22px 0 0;text-align:center}
.auth-foot{margin-top:auto;padding-top:28px;font-size:12px;color:var(--ink-4);text-align:center}
`;

// --- Chuyển động ---
const MOTION = `
@keyframes rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
@keyframes fade{from{opacity:0}to{opacity:1}}
@keyframes pop{from{opacity:0;transform:translateY(-6px) scale(.97)}to{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,currentColor 0%,transparent),0 0 0 0 rgba(120,140,255,.5)}70%{box-shadow:0 0 0 7px rgba(120,140,255,0)}100%{box-shadow:0 0 0 0 rgba(120,140,255,0)}}
@keyframes grow-x{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@keyframes grow-y{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@keyframes toast-in{from{opacity:0;transform:translateX(28px) scale(.96)}to{opacity:1;transform:none}}
@keyframes toast-out{to{opacity:0;transform:translateX(28px) scale(.96)}}
@keyframes aurora{0%{transform:translate3d(-4%,-3%,0) scale(1)}100%{transform:translate3d(5%,4%,0) scale(1.15)}}
@keyframes float{0%,100%{transform:translate(0,0)}50%{transform:translate(18px,-22px)}}

/* vào trang: các khối hiện lần lượt, một nhịp duy nhất */
.page>*{animation:rise .55s var(--ease) both}
.page>*:nth-child(2){animation-delay:.05s}.page>*:nth-child(3){animation-delay:.1s}.page>*:nth-child(4){animation-delay:.15s}
.page>*:nth-child(5){animation-delay:.2s}.page>*:nth-child(6){animation-delay:.25s}.page>*:nth-child(n+7){animation-delay:.3s}
.kpis .kpi{animation:rise .55s var(--ease) both}
.kpis .kpi:nth-child(2){animation-delay:.07s}.kpis .kpi:nth-child(3){animation-delay:.14s}.kpis .kpi:nth-child(4){animation-delay:.21s}
tbody tr{animation:fade .4s var(--ease) both}
tbody tr:nth-child(-n+12){animation-name:rise}
tbody tr:nth-child(2){animation-delay:.03s}tbody tr:nth-child(3){animation-delay:.06s}tbody tr:nth-child(4){animation-delay:.09s}tbody tr:nth-child(5){animation-delay:.12s}tbody tr:nth-child(6){animation-delay:.15s}tbody tr:nth-child(n+7){animation-delay:.18s}

/* chuyển trang: chỉ vùng nội dung đổi, thanh bên và thanh đầu giữ nguyên; vạch menu trượt sang mục mới */
@view-transition{navigation:auto}
::view-transition-old(root){animation:vt-out .16s var(--ease-in) both}
::view-transition-new(root){animation:vt-in .34s var(--ease) both}
::view-transition-group(nav-ind){animation-duration:.4s;animation-timing-function:var(--ease)}
::view-transition-group(rail),::view-transition-group(topbar){animation-duration:0s}
@keyframes vt-out{to{opacity:0;transform:translateY(-6px)}}
@keyframes vt-in{from{opacity:0;transform:translateY(10px)}}

@media (prefers-reduced-motion:reduce){
  *,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;animation-delay:0s!important;transition-duration:.001ms!important;scroll-behavior:auto!important}
  ::view-transition-group(*),::view-transition-old(*),::view-transition-new(*){animation:none!important}
}
`;

// --- Đáp ứng: máy tính bảng và điện thoại ---
const RESPONSIVE = `
@media (max-width:1200px){.hero{grid-template-columns:minmax(0,1fr)}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.cols{grid-template-columns:minmax(0,1fr)}}
@media (max-width:980px){
  .shell{grid-template-columns:1fr}
  .side{position:fixed;inset:0 auto 0 0;width:min(300px,86vw);height:100dvh;transform:translateX(-102%);transition:transform .32s var(--ease);box-shadow:var(--sh-pop);view-transition-name:none}
  html[data-nav="open"] .side{transform:none}
  html[data-nav="open"] .scrim{display:block;position:fixed;inset:0;z-index:35;background:rgba(8,13,24,.55);backdrop-filter:blur(3px);animation:fade .25s}
  html[data-rail="mini"] .shell{--rail-w:auto}
  html[data-rail="mini"] .nav-i{justify-content:flex-start;padding:9px 12px}
  html[data-rail="mini"] .nav-i>span:not(.badge),html[data-rail="mini"] .brand-t,html[data-rail="mini"] .nav-g,html[data-rail="mini"] .who{display:revert}
  .cmdk-trigger{min-width:0;width:38px;padding:0;justify-content:center}.cmdk-trigger span,.cmdk-trigger .kbd{display:none}
  .form-grid{grid-template-columns:1fr}
  .split{grid-template-columns:minmax(0,1fr)}
  .toolbar input[type=search]{width:100%}
  .verdicts{grid-template-columns:1fr}
  .slot{grid-template-columns:1fr;gap:6px}.slot .h{white-space:normal}
  .studio-frame{height:72vh;min-height:480px}
  .auth{grid-template-columns:minmax(0,1fr)}
  .auth-art{padding:24px}.auth-copy,.auth-art-foot{display:none}
  .auth-form{padding:20px 20px 24px}
  .auth-form .theme{position:static;align-self:flex-end;margin:0 0 12px}
}
@media (max-width:640px){
  .kpis{grid-template-columns:minmax(0,1fr)}
  .legend{grid-template-columns:minmax(0,1fr)}
  .usermenu .nm{display:none}
  h1{font-size:23px}
  .hero{padding:22px 20px}
  .todo li{flex-direction:column;align-items:stretch}
  .bulk-bar{position:static;box-shadow:none}
  .toasts{left:16px;right:16px;top:70px}
  .topbar-title{display:none}
}
`;

// Lớp tiện ích w0..w100 (rộng %), h0..h100 (cao %), ring-0..ring-100 (điểm) để biểu đồ gán theo dữ liệu mà không cần style nội tuyến (CSP).
const steps = Array.from({ length: 101 }, (_, i) => `.w${i}{width:${i}%}.h${i}{height:${i}%}.ring-${i}{--p:${i}}
`).join('');

const UTIL = `.u-m0{margin:0}.u-mt6{margin-top:6px}.u-mt12{margin-top:12px}.u-mt14{margin-top:14px}.u-mt16{margin-top:16px}
.u-fw4{font-weight:400}.u-fs20{font-size:20px}.u-fs24-my6{font-size:24px;margin:6px 0}.u-minw200{min-width:200px}.u-h22{height:22px}
`;

export const CSS = FONTS + TOKENS + BASE + SHELL + SURFACES + DATA + FORMS + WIDGETS + AUTH + MOTION + RESPONSIVE + UTIL + steps;
