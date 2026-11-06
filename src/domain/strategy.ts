// Chiến lược nội dung: trụ cột chủ đề, cờ rủi ro để định tuyến mức đọc, và phát hiện bài trùng ý. Thuần, không I/O.
// Trụ cột và từ khóa là cấu hình mặc định trong mã; chỉnh ở đây (hoặc chuyển sang cài đặt khi Marketing có danh sách riêng).
import { isIncidentText } from './autoApprove.ts';
import type { ContentPackage, Market } from './package.ts';

// --- Trụ cột nội dung ---

export const PILLARS = ['security', 'ai', 'semiconductor', 'cloud', 'workforce', 'other'] as const;
export type Pillar = (typeof PILLARS)[number];

export const PILLAR_LABEL: Record<Pillar, string> = {
  security: 'An ninh mạng',
  ai: 'AI',
  semiconductor: 'Bán dẫn',
  cloud: 'Hạ tầng và đám mây',
  workforce: 'Nhân lực và chuyển đổi số',
  other: 'Khác',
};

// Thứ tự quan trọng: trụ cột đứng trước thắng khi một bài khớp nhiều trụ cột. An ninh mạng ưu tiên vì có quy tắc duyệt riêng.
const KEYWORDS: [Pillar, RegExp][] = [
  ['security', /bảo mật|an ninh mạng|an toàn thông tin|tấn công mạng|mã độc|ransomware|lỗ hổng|rò rỉ|lộ dữ liệu|hacker|セキュリティ|サイバー|脆弱性|ランサム|不正アクセス|情報漏洩|漏えい/iu],
  ['semiconductor', /bán dẫn|vi mạch|\bchip\b|wafer|tsmc|nvidia|samsung electronics|半導体|ウエハ|ファブ/iu],
  ['ai', /trí tuệ nhân tạo|\bAI\b|machine learning|học máy|llm|chatbot|generative|gpt|gemini|claude|生成AI|人工知能|機械学習|大規模言語/iu],
  ['cloud', /đám mây|\bcloud\b|trung tâm dữ liệu|data ?center|hạ tầng|máy chủ|aws|azure|クラウド|データセンター|サーバー|インフラ/iu],
  ['workforce', /nhân lực|nhân sự|tuyển dụng|chuyển đổi số|kỹ sư|đào tạo|lập trình viên|dx\b|人材|採用|デジタル変革|DX|エンジニア|研修/iu],
];

/** Trụ cột của bài, theo từ khóa trong tiêu đề, tóm tắt chủ đề và thân bài (tiêu đề có trọng số cao nhất). */
export function classifyPillar(pkg: ContentPackage): Pillar {
  const head = `${pkg.post.headline}\n${pkg.topic_summary}`;
  for (const [p, re] of KEYWORDS) if (re.test(head)) return p;
  for (const [p, re] of KEYWORDS) if (re.test(pkg.post.body)) return p;
  return 'other';
}

/** Đếm bài theo trụ cột; trả về tỷ lệ để hiện cân bằng nội dung. */
export function pillarBalance(pkgs: ContentPackage[]): { pillar: Pillar; n: number; pct: number }[] {
  const counts = new Map<Pillar, number>();
  for (const p of pkgs) counts.set(classifyPillar(p), (counts.get(classifyPillar(p)) ?? 0) + 1);
  const total = pkgs.length || 1;
  return PILLARS.map((pillar) => ({ pillar, n: counts.get(pillar) ?? 0, pct: Math.round(((counts.get(pillar) ?? 0) / total) * 100) }));
}

// --- Cờ rủi ro nội dung ---

export interface RiskFlag {
  code: 'incident' | 'figures' | 'legal' | 'named_company' | 'unverified';
  /** high: cần đọc từng câu; medium: cần đối chiếu nguồn. */
  level: 'high' | 'medium';
  text: string;
}

const FIGURES = /\d[\d.,]*\s?(%|phần trăm|tỷ|triệu|nghìn|USD|VND|JPY|yên|đô|億|万|兆|円|ドル)/iu;
const LEGAL = /luật|nghị định|thông tư|vi phạm|xử phạt|kiện|bồi thường|法律|規制|違反|罰則|訴訟|賠償/iu;
// Tên doanh nghiệp hay gặp trong tin sự cố: dạng "Công ty X", "Tập đoàn X", "X株式会社".
const COMPANY = /(?:[Cc]ông ty|[Tt]ập đoàn|[Nn]gân hàng)\s+[A-ZÀ-Ỵ]|株式会社|(?:^|\s)[A-Z][A-Za-z]+\s+(Corp|Inc|Ltd|Co\.)/u;

/** Các dấu hiệu khiến bài cần người duyệt đọc kỹ hơn. Không thay thế việc đọc; chỉ để xếp ưu tiên và nhắc. */
export function riskFlags(pkg: ContentPackage): RiskFlag[] {
  const text = `${pkg.post.headline}\n${pkg.post.body}`;
  const flags: RiskFlag[] = [];
  if (isIncidentText(text)) flags.push({ code: 'incident', level: 'high', text: 'Tin sự cố bảo mật: đọc từng câu, kiểm tra tên tổ chức và mức độ thiệt hại' });
  if (COMPANY.test(text) && isIncidentText(text)) flags.push({ code: 'named_company', level: 'high', text: 'Nêu tên tổ chức trong tin sự cố: chỉ giữ điều nguồn đã xác nhận' });
  if (pkg.claims_to_verify.length > 0) flags.push({ code: 'unverified', level: 'medium', text: `${pkg.claims_to_verify.length} khẳng định cần đối chiếu nguồn` });
  if (FIGURES.test(text)) flags.push({ code: 'figures', level: 'medium', text: 'Có số liệu: đối chiếu với nguồn' });
  if (LEGAL.test(text)) flags.push({ code: 'legal', level: 'medium', text: 'Nhắc tới quy định hoặc trách nhiệm pháp lý: kiểm tra cách diễn đạt' });
  return flags;
}

/** Mức cần chú ý để xếp hàng chờ: cao nhất đọc trước. 0 = không có cờ. */
export function attentionScore(flags: RiskFlag[], qualityScore: number): number {
  const risk = flags.reduce((s, f) => s + (f.level === 'high' ? 40 : 15), 0);
  return risk + Math.max(0, 100 - qualityScore) / 2;
}

// --- Chống trùng ý ---

const STOP = new Set(['và', 'của', 'là', 'có', 'cho', 'các', 'những', 'một', 'được', 'trong', 'với', 'để', 'từ', 'này', 'đã', 'sẽ', 'về', 'the', 'a', 'of', 'to', 'in', 'and', 'for', 'に', 'の', 'は', 'を', 'が', 'で', 'と']);

/** Tập từ khóa chuẩn hóa: bỏ dấu câu, chữ thường, bỏ từ dừng; tiếng Nhật dùng cặp ký tự liền nhau (bigram) vì không có khoảng trắng. */
export function keyTokens(text: string, market: Market): Set<string> {
  const t = text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const out = new Set<string>();
  if (market === 'JP') {
    for (const run of t.split(/\s+/)) {
      const cs = [...run];
      for (let i = 0; i < cs.length - 1; i++) out.add(cs[i]! + cs[i + 1]!);
    }
    return out;
  }
  for (const w of t.split(/\s+/)) if (w.length > 1 && !STOP.has(w)) out.add(w);
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface RecentPost {
  id: number;
  headline: string;
  summary: string;
}

/** Ngưỡng coi là cùng một câu chuyện. Đo trên tiêu đề và tóm tắt chủ đề; 0,5 đủ chặt để không chặn nhầm hai tin khác nhau cùng ngành. */
export const DUPLICATE_THRESHOLD = 0.5;

/** Bài gần đây giống bài mới nhất; null nếu không có. */
export function findDuplicate(pkg: ContentPackage, recent: RecentPost[], threshold = DUPLICATE_THRESHOLD): { id: number; headline: string; score: number } | null {
  const mine = keyTokens(`${pkg.post.headline} ${pkg.topic_summary}`, pkg.market);
  let best: { id: number; headline: string; score: number } | null = null;
  for (const r of recent) {
    const score = jaccard(mine, keyTokens(`${r.headline} ${r.summary}`, pkg.market));
    if (score >= threshold && (!best || score > best.score)) best = { id: r.id, headline: r.headline, score: Math.round(score * 100) / 100 };
  }
  return best;
}
