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
      cues.push({ start: times[startIdx]![0], end: times[lastIdx]![1], text: wrapLines(text, opts.maxCharsPerLine) });
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
      const cut = lastSoftBreak(buf);
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

/** Ưu tiên ngắt ở dấu ngắt hơi (nếu nằm sau ~40% bộ đệm), rồi mới tới khoảng trắng, để không cắt giữa cụm từ. */
function lastSoftBreak(s: string): number {
  for (let i = s.length - 1; i >= Math.floor(s.length * 0.4); i--) if (PAUSE_BREAK.has(s[i]!)) return i;
  for (let i = s.length - 1; i > 0; i--) if (SOFT_BREAK.has(s[i]!)) return i;
  return -1;
}

function wrapLines(text: string, maxPerLine: number): string {
  if (text.length <= maxPerLine) return text;
  const mid = Math.ceil(text.length / 2);
  let cut = -1;
  for (let d = 0; d < text.length; d++) {
    for (const i of [mid - d, mid + d]) {
      if (i > 0 && i < text.length && SOFT_BREAK.has(text[i]!)) {
        cut = i;
        break;
      }
    }
    if (cut >= 0) break;
  }
  if (cut < 0) cut = mid;
  return `${text.slice(0, cut + 1).trim()}\n${text.slice(cut + 1).trim()}`;
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
