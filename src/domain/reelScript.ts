// Kịch bản video Reels từ một bài: chọn mẫu bố cục, soạn lời đọc, dựng phụ đề. Thuần, không I/O nên test được.
import { buildCues, estimateTimings, type Cue } from './subtitles.ts';
import { isIncidentText } from './autoApprove.ts';
import type { ContentPackage, Market } from './package.ts';

export type ReelTemplate = 'list' | 'focus' | 'alert';

/** Giây lời đọc tối thiểu/tối đa mà dịch vụ render chấp nhận (khớp schema peapod-video). */
export const VOICE_MIN_SEC = 3;
export const VOICE_MAX_SEC = 90;

/**
 * Chọn mẫu bố cục:
 * - alert: tin sự cố/bảo mật (cùng bộ từ khóa với tự duyệt), tông đỏ, tiêu đề "CẢNH BÁO".
 * - focus: ít ý (≤ 2), mỗi ý một cảnh chữ lớn.
 * - list: còn lại, các ý xếp thành danh sách.
 */
export function chooseTemplate(pkg: ContentPackage, bullets: string[]): ReelTemplate {
  const text = `${pkg.post.headline}\n${pkg.post.body}`;
  if (isIncidentText(text)) return 'alert';
  if (bullets.length <= 2) return 'focus';
  return 'list';
}

const END: Record<Market, string> = { VN: '.', JP: '。' };

function sentence(s: string, market: Market): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (!t) return '';
  return /[.!?。！？…]$/u.test(t) ? t : `${t}${END[market]}`;
}

/**
 * Lời đọc: tiêu đề, các ý chính, nhận định. Không đọc nguồn, ngày hay hashtag. Giới hạn độ dài để video không quá ~45 giây
 * (tiếng Việt ~14 ký tự/giây, tiếng Nhật ~7 ký tự/giây khi đọc tự nhiên).
 */
export function voiceScript(title: string, bullets: string[], takeaway: string | null, market: Market): string {
  const maxChars = market === 'JP' ? 300 : 560;
  const parts = [title, ...bullets, takeaway ?? ''].map((p) => sentence(p, market)).filter(Boolean);
  const out: string[] = [];
  let len = 0;
  for (const p of parts) {
    const add = [...p].length + 1;
    if (len + add > maxChars && out.length >= 2) break; // luôn giữ tiêu đề và ít nhất một ý
    out.push(p);
    len += add;
  }
  return out.join(market === 'JP' ? '' : ' ');
}

/** Số ký tự mỗi dòng phụ đề theo cỡ chữ 46px trên khung rộng 888px. */
const CHARS_PER_LINE: Record<Market, number> = { VN: 26, JP: 15 };

/**
 * Phụ đề từ lời đọc và thời lượng thật của WAV. Mốc thời gian là ước lượng theo ký tự (Gemini TTS không trả timestamp),
 * nên có thể lệch vài trăm mili giây; cần nghe thử khi đổi giọng.
 */
export function buildReelCaptions(script: string, durationSec: number, market: Market): Cue[] {
  const { chars, times } = estimateTimings(script, durationSec);
  if (!times.length) return [];
  return buildCues(chars, times, { maxCharsPerLine: CHARS_PER_LINE[market], locale: market === 'JP' ? 'ja' : 'vi' }).map((c) => ({
    start: round2(c.start),
    end: round2(c.end),
    text: c.text.slice(0, 120),
  }));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Thời lượng lời đọc hợp lệ với dịch vụ render; ngoài khoảng thì coi như không dùng được. */
export function voiceDurationOk(sec: number): boolean {
  return Number.isFinite(sec) && sec >= VOICE_MIN_SEC && sec <= VOICE_MAX_SEC;
}
