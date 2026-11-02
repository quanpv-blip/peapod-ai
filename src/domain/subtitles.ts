// FR-MED-05: dựng phụ đề từ timestamp theo ký tự của xAI TTS (`with_timestamps: true`), không cần nhận dạng giọng nói.
// Định dạng đầu vào: graph_chars (mỗi ký tự đầu vào) và graph_times (song song, [start, end] theo giây). Xem docs/04 mục 2.5.

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleOptions {
  /** Số ký tự tối đa mỗi dòng: ~18 cho JP, ~42 cho VN. */
  maxCharsPerLine: number;
  maxLines?: number;
  /** 'ja' | 'vi'...: bật cắt theo ranh giới từ (Intl.Segmenter). Cần cho tiếng Nhật vì không có khoảng trắng. */
  locale?: string;
}

const SENTENCE_END = new Set(['。', '.', '!', '?', '！', '？', '\n']);
const SOFT_BREAK = new Set(['、', ',', ';', '；', ' ', '，']);

export function buildCues(chars: string[], times: [number, number][], opts: SubtitleOptions): Cue[] {
  if (chars.length !== times.length) throw new Error('graph_chars và graph_times phải cùng độ dài');
  const maxLines = opts.maxLines ?? 2;
  const maxChars = opts.maxCharsPerLine * maxLines;
  const cues: Cue[] = [];

  let buf = '';
  let startIdx = -1;
  let lastIdx = -1;

  const flush = () => {
    const text = buf.trim();
    if (text && startIdx >= 0) {
      cues.push({ start: times[startIdx]![0], end: times[lastIdx]![1], text: wrapLines(text, opts.maxCharsPerLine, opts.locale) });
    }
    buf = '';
    startIdx = -1;
    lastIdx = -1;
  };

  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (startIdx < 0) {
      if (c.trim() === '') continue;
      startIdx = i;
    }
    buf += c;
    lastIdx = i;
    if (SENTENCE_END.has(c)) {
      flush();
    } else if (buf.length >= maxChars) {
      // Cắt tại dấu ngắt mềm gần nhất; nếu không có thì cắt cứng.
      const cut = lastSoftBreak(buf, opts.locale);
      if (cut > 0 && cut < buf.length - 1) {
        const rest = buf.slice(cut + 1);
        const restStart = lastIdx - rest.length + 1;
        buf = buf.slice(0, cut + 1);
        lastIdx = restStart - 1;
        flush();
        buf = rest;
        startIdx = restStart;
        lastIdx = i;
      } else {
        flush();
      }
    }
  }
  flush();
  return cues;
}

const PAUSE_BREAK = new Set(['、', ',', ';', '；', '，']);

const PAUSE_WEIGHT: Record<string, number> = { '。': 6, '.': 6, '!': 6, '?': 6, '！': 6, '？': 6, '、': 3, ',': 3, '，': 3, ';': 3, '；': 3 };

/**
 * Ước lượng timestamp theo ký tự khi TTS không trả (Gemini TTS, docs/99 E-22): chia thời lượng thật của âm thanh
 * theo trọng số, dấu câu "chiếm" thời gian nghỉ. Kết quả cùng định dạng graph_times để dùng chung buildCues.
 * Độ chính xác thấp hơn timestamp thật: phải kiểm bằng tai ở G-4 (mục tiêu lệch ≤ 0,3 s, FR-MED-05).
 */
export function estimateTimings(text: string, durationSec: number): { chars: string[]; times: [number, number][] } {
  const chars = [...text];
  if (chars.length === 0 || durationSec <= 0) return { chars, times: [] };
  const weights = chars.map((c) => (c.trim() === '' ? 0.5 : (PAUSE_WEIGHT[c] ?? 1)));
  const total = weights.reduce((a, b) => a + b, 0);
  let t = 0;
  const times = weights.map((w) => {
    const start = t;
    t += (w / total) * durationSec;
    return [start, t] as [number, number];
  });
  return { chars, times };
}

const segmenters = new Map<string, Intl.Segmenter>();

/** Chỉ số (UTF-16) của ký tự cuối mỗi từ theo ICU, để không cắt giữa từ. */
function wordEnds(s: string, locale?: string): Set<number> {
  const ends = new Set<number>();
  if (!locale) return ends;
  let seg = segmenters.get(locale);
  if (!seg) {
    seg = new Intl.Segmenter(locale, { granularity: 'word' });
    segmenters.set(locale, seg);
  }
  const ja = locale.startsWith('ja');
  for (const part of seg.segment(s)) {
    if (ja && !jaBreakAfter(part.segment)) continue;
    ends.add(part.index + part.segment.length - 1);
  }
  return ends;
}

const JA_PARTICLES = new Set(['は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'へ', 'や', 'か']);

/**
 * ICU tách chuỗi hiragana quá vụn ("ございます" -> ご|ざ|い|ます). Chỉ cho ngắt sau: từ có chữ Hán/Katakana/Latin/số,
 * trợ từ một ký tự, hoặc dấu câu. Không ngắt giữa chuỗi hiragana thuần (đuôi động từ, trợ động từ).
 */
function jaBreakAfter(segment: string): boolean {
  if (JA_PARTICLES.has(segment)) return true;
  if (/[一-鿿゠-ヿ㐀-䶿A-Za-z0-9]/.test(segment)) return true;
  return !/[぀-ゟ]/.test(segment); // dấu câu, khoảng trắng
}

/** Ưu tiên ngắt ở dấu ngắt hơi (sau ~40% bộ đệm), rồi ranh giới từ/khoảng trắng; -1 nếu không có (sẽ cắt cứng). */
function lastSoftBreak(s: string, locale?: string): number {
  for (let i = s.length - 1; i >= Math.floor(s.length * 0.4); i--) if (PAUSE_BREAK.has(s[i]!)) return i;
  const ends = wordEnds(s, locale);
  // Bỏ từ cuối cùng của bộ đệm: có thể mới được cắt dở.
  for (let i = s.length - 2; i > 0; i--) if (SOFT_BREAK.has(s[i]!) || ends.has(i)) return i;
  return -1;
}

function wrapLines(text: string, maxPerLine: number, locale?: string): string {
  if (text.length <= maxPerLine) return text;
  const ends = wordEnds(text, locale);
  const mid = Math.ceil(text.length / 2);
  let cut = -1;
  // Tìm điểm ngắt gần giữa nhất; không ngắt ở ký tự cuối (sẽ để dòng thứ hai rỗng).
  for (let d = 0; d < text.length && cut < 0; d++) {
    for (const i of [mid - d, mid + d]) {
      if (i > 0 && i < text.length - 1 && (SOFT_BREAK.has(text[i]!) || ends.has(i))) {
        cut = i;
        break;
      }
    }
  }
  if (cut < 0) cut = mid;
  return `${text.slice(0, cut + 1).trim()}
${text.slice(cut + 1).trim()}`;
}

function ts(sec: number): string {
  const ms = Math.round(sec * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
}

export function toSrt(cues: Cue[]): string {
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}
