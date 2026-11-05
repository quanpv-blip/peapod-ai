// Dựng ảnh thẻ 1080x1350 (E6) bằng Satori (JSX-free, dạng cây phần tử) và resvg. Không cần trình duyệt hay giấy phép Remotion.
// Phông: Noto Sans (Latin + Tiếng Việt) và Noto Sans JP (Tiếng Nhật), đều từ gói @fontsource đã cài.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import type { ContentPackage, Market } from '../domain/package.ts';

export interface CardInput {
  market: Market;
  title: string;
  bullets: string[];
  /** Nhận định của đội (khối "当社の見方" / "Nhận định của chúng tôi"); null nếu bài không có. */
  takeaway: string | null;
  source: string;
  date: string;
}

export const CARD_W = 1080;
export const CARD_H = 1350;

// Bảng màu và nhãn phải khớp với peapod-video/src/brand.ts (Remotion). Đổi ở đây thì đổi cả bên kia.
const INK = '#1c2024';
const MUTED = '#4b5563';
const SOFT = '#6b7280';
const LINE = '#e5e7eb';
const ACCENT = '#4f46e5';
const TINT = '#eef2ff';
const LABELS = {
  VN: { source: 'Nguồn', takeaway: 'Nhận định của chúng tôi' },
  JP: { source: '出典', takeaway: '当社の見方' },
} as const;

type El = { type: string; props: { style: Record<string, unknown>; children?: (El | string)[] | El | string } };
const el = (type: string, style: Record<string, unknown>, ...children: (El | string | false | undefined)[]): El => ({
  type,
  props: { style: { display: 'flex', ...style }, children: children.filter((c): c is El | string => c !== false && c !== undefined) },
});

const req = createRequire(import.meta.url);
const fontFile = (pkg: string, name: string) => readFileSync(path.join(path.dirname(req.resolve(`${pkg}/package.json`)), 'files', name));

type FontDef = { name: string; data: Buffer; weight: 400 | 700; style: 'normal' };
let fontsCache: FontDef[] | undefined;
function fonts(): FontDef[] {
  // Mỗi phông một tên họ riêng: Satori chọn phông theo thứ tự trong font-family, nên không gộp các tệp cùng tên.
  fontsCache ??= [
    { name: 'NotoVN', data: fontFile('@fontsource/noto-sans', 'noto-sans-vietnamese-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'NotoVN', data: fontFile('@fontsource/noto-sans', 'noto-sans-vietnamese-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'NotoLatin', data: fontFile('@fontsource/noto-sans', 'noto-sans-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'NotoLatin', data: fontFile('@fontsource/noto-sans', 'noto-sans-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'NotoJP', data: fontFile('@fontsource/noto-sans-jp', 'noto-sans-jp-japanese-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'NotoJP', data: fontFile('@fontsource/noto-sans-jp', 'noto-sans-jp-japanese-700-normal.woff'), weight: 700, style: 'normal' },
  ];
  return fontsCache;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function cardTree(c: CardInput): El {
  const family = 'NotoVN, NotoLatin, NotoJP';
  const TEXT_W = CARD_W - 2 * 88;
  return el(
    'div',
    { width: CARD_W, height: CARD_H, backgroundColor: '#ffffff', flexDirection: 'column', padding: 88, fontFamily: family, color: INK },
    el('div', { alignItems: 'center', justifyContent: 'space-between', width: TEXT_W },
      el('div', { alignItems: 'center' },
        el('div', { width: 56, height: 56, borderRadius: 10, backgroundColor: ACCENT, color: '#ffffff', alignItems: 'center', justifyContent: 'center', fontSize: 30, fontWeight: 700 }, 'P'),
        el('div', { marginLeft: 18, fontSize: 30, fontWeight: 700 }, 'PeaPod AI'),
      ),
      el('div', { border: `2px solid ${ACCENT}`, borderRadius: 999, padding: '8px 22px', color: ACCENT, fontSize: 26, fontWeight: 700 }, c.market),
    ),
    el('div', { width: 120, height: 6, backgroundColor: ACCENT, marginTop: 44 }),
    el('div', { width: TEXT_W, marginTop: 40, fontSize: 70, fontWeight: 700, lineHeight: 1.25 }, clip(c.title, 90)),
    el('div', { flexDirection: 'column', marginTop: 52 },
      ...c.bullets.slice(0, 3).map((b) =>
        el('div', { alignItems: 'flex-start', width: TEXT_W, marginBottom: 26 },
          el('div', { width: 14, height: 14, borderRadius: 3, backgroundColor: ACCENT, marginTop: 14, marginRight: 22, flex: 'none' }),
          el('div', { width: TEXT_W - 36, fontSize: 40, lineHeight: 1.45, color: MUTED }, clip(b, 80)),
        ),
      ),
    ),
    c.takeaway
      ? el('div', { flexDirection: 'column', width: TEXT_W, marginTop: 30, backgroundColor: TINT, borderLeft: `6px solid ${ACCENT}`, borderRadius: 14, padding: '26px 32px' },
          el('div', { fontSize: 26, fontWeight: 700, color: ACCENT }, LABELS[c.market].takeaway),
          el('div', { marginTop: 10, fontSize: 32, lineHeight: 1.5, color: INK }, c.takeaway),
        )
      : el('div', {}),
    el('div', { width: TEXT_W, marginTop: 48, borderTop: `2px solid ${LINE}`, paddingTop: 30, alignItems: 'flex-end', justifyContent: 'space-between' },
      el('div', { fontSize: 28, color: SOFT, maxWidth: 760 }, `${LABELS[c.market].source}: ${clip(c.source, 80)}`),
      el('div', { fontSize: 28, color: SOFT }, c.date),
    ),
  );
}

/**
 * Lấy nhận định từ thân bài: đoạn ngay sau nhãn "当社の見方" (JP) hoặc "Nhận định của chúng tôi" (VN).
 * Dừng ở dòng trống, dòng nguồn, hoặc dòng hashtag. Giới hạn 160 ký tự để khớp với Remotion.
 */
export function extractTakeaway(body: string, market: Market): string | null {
  const marker = market === 'JP' ? '当社の見方' : 'Nhận định của chúng tôi';
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l.includes(marker));
  if (i < 0) return null;
  const parts: string[] = [];
  const same = lines[i]!.split(marker)[1]?.replace(/^[:：\s]+/, '').trim();
  if (same) parts.push(same);
  for (let j = i + 1; j < lines.length; j++) {
    const t = lines[j]!.trim();
    if (!t) {
      if (parts.length) break;
      continue;
    }
    if (/^(出典|Nguồn|#)/.test(t)) break;
    parts.push(t);
  }
  const text = parts.join(' ').trim();
  return text ? clip(text, 160) : null;
}

/** Dữ liệu thẻ từ một gói bài. Cắt chữ theo đúng giới hạn để cả Satori và Remotion đều nhận được. */
export function cardInputFrom(pkg: ContentPackage, date: string): CardInput {
  const bullets = (pkg.media.card as { bullets?: string[] } | undefined)?.bullets ?? [];
  return {
    market: pkg.market,
    title: clip(pkg.post.headline, 90),
    bullets: bullets.slice(0, 3).map((b) => clip(b, 80)),
    takeaway: extractTakeaway(pkg.post.body, pkg.market),
    source: clip(pkg.sources[0]!.title, 80),
    date,
  };
}

/** Trả về PNG 1080x1350. Ném lỗi nếu thiếu phông hoặc Satori không dựng được thẻ. */
export async function renderCard(c: CardInput): Promise<Buffer> {
  const svg = await satori(cardTree(c) as unknown as Parameters<typeof satori>[0], { width: CARD_W, height: CARD_H, fonts: fonts() as unknown as Parameters<typeof satori>[1]['fonts'] });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: CARD_W } }).render().asPng();
  return Buffer.from(png);
}
