// Bộ nhận diện PeaPod AI, vẽ bằng SVG thuần (không tải ảnh ngoài, không phụ thuộc phông).
// Ý tưởng logo: một quả đậu (pod) chứa ba hạt đậu (ba nhịp đăng bài đều đặn: sinh, duyệt, đăng) và một tia sáng nhỏ (AI).

export const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="PeaPod AI">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#6366f1"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity=".35"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="17" fill="url(#bg)"/>
  <path d="M10 33c0-11.6 9.6-19 22-19 6.4 0 13.5 2.6 17.6 8.4C52.4 26 52 28.2 52 33c0 11.2-8.8 19-21 19S10 44.2 10 33z" fill="#ffffff" fill-opacity=".16"/>
  <path d="M10 33c0-11.6 9.6-19 22-19 6.4 0 13.5 2.6 17.6 8.4C52.4 26 52 28.2 52 33c0 11.2-8.8 19-21 19S10 44.2 10 33z" fill="url(#shine)"/>
  <circle cx="23" cy="33" r="5" fill="#ffffff"/>
  <circle cx="32" cy="33" r="5" fill="#ffffff"/>
  <circle cx="41" cy="33" r="5" fill="#ffffff"/>
  <path d="M49.5 9.5l1.1 2.9 2.9 1.1-2.9 1.1-1.1 2.9-1.1-2.9-2.9-1.1 2.9-1.1z" fill="#a5f3fc"/>
</svg>`;

// Nền màn đăng nhập: dải màu chuyển, các vòng mờ, lưới chấm và sóng hạt đậu. Dùng cho khung giới thiệu bên trái.
export const LOGIN_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1e1b4b"/>
      <stop offset=".5" stop-color="#4338ca"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
    <radialGradient id="glow" cx=".8" cy=".15" r=".6">
      <stop offset="0" stop-color="#67e8f9" stop-opacity=".45"/>
      <stop offset="1" stop-color="#67e8f9" stop-opacity="0"/>
    </radialGradient>
    <pattern id="dots" width="36" height="36" patternUnits="userSpaceOnUse">
      <circle cx="3" cy="3" r="1.6" fill="#ffffff" fill-opacity=".22"/>
    </pattern>
  </defs>
  <rect width="1200" height="1000" fill="url(#base)"/>
  <rect width="1200" height="1000" fill="url(#glow)"/>
  <rect width="1200" height="1000" fill="url(#dots)"/>
  <g fill="none" stroke="#ffffff" stroke-opacity=".16" stroke-width="2">
    <circle cx="980" cy="160" r="180"/>
    <circle cx="980" cy="160" r="260"/>
    <circle cx="980" cy="160" r="340"/>
  </g>
  <g fill="#ffffff" fill-opacity=".09">
    <ellipse cx="170" cy="700" rx="150" ry="95" transform="rotate(-18 170 700)"/>
    <circle cx="150" cy="690" r="22"/>
    <circle cx="200" cy="706" r="22"/>
    <circle cx="250" cy="722" r="22"/>
  </g>
  <path d="M0 780 C 200 700, 400 860, 600 790 S 1000 720, 1200 800 L1200 1000 L0 1000 Z" fill="#ffffff" fill-opacity=".07"/>
  <path d="M0 860 C 260 800, 520 920, 780 860 S 1100 800, 1200 840 L1200 1000 L0 1000 Z" fill="#ffffff" fill-opacity=".06"/>
</svg>`;

// Nền thanh bên: lưới chấm mờ ở đầu, không che điều hướng. Hoạt động ở cả hai chế độ sáng và tối.
export const SIDE_BG_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 260" preserveAspectRatio="xMidYMin slice">
  <defs>
    <pattern id="sd" width="18" height="18" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.3" fill="#6366f1" fill-opacity=".22"/>
    </pattern>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff" stop-opacity="1"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
    <mask id="m"><rect width="260" height="260" fill="url(#fade)"/></mask>
  </defs>
  <rect width="260" height="260" fill="url(#sd)" mask="url(#m)"/>
  <g fill="none" stroke="#6366f1" stroke-opacity=".14" stroke-width="1.2" mask="url(#m)">
    <circle cx="230" cy="-10" r="90"/>
    <circle cx="230" cy="-10" r="140"/>
  </g>
</svg>`;
