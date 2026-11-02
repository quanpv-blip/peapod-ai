// FR-RES-05: loại thông tin nhạy cảm trước khi gửi ngữ cảnh lên xAI. Chỉ ghi số lần loại bỏ, không ghi nội dung gốc.

export interface SanitizeOptions {
  /** Tên khách hàng/dự án cần che (không phân biệt hoa thường). */
  denyTerms?: string[];
  /** Tên miền nội bộ cần che (vd: peasoft.vn). */
  internalDomains?: string[];
}

export interface SanitizeResult {
  text: string;
  redactions: Record<string, number>;
}

const PATTERNS: { type: string; re: RegExp; to: string }[] = [
  { type: 'code_block', re: /```[\s\S]*?```/g, to: '[CODE]' },
  { type: 'api_key', re: /\b(?:xai-[A-Za-z0-9]{16,}|EAA[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g, to: '[SECRET]' },
  { type: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, to: '[EMAIL]' },
  // Điện thoại VN (+84/0 + 9-10 số) và JP (+81/0 + 9-10 số), cho phép dấu cách/gạch nối.
  { type: 'phone', re: /(?:\+?84|\+?81|\b0)[\s.-]?\d(?:[\s.-]?\d){7,10}\b/g, to: '[PHONE]' },
  { type: 'ip', re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, to: '[IP]' },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitize(input: string, opts: SanitizeOptions = {}): SanitizeResult {
  let text = input;
  const redactions: Record<string, number> = {};
  const apply = (type: string, re: RegExp, to: string) => {
    text = text.replace(re, () => {
      redactions[type] = (redactions[type] ?? 0) + 1;
      return to;
    });
  };

  for (const p of PATTERNS) apply(p.type, p.re, p.to);
  for (const d of opts.internalDomains ?? []) {
    apply('internal_domain', new RegExp(`(?:[A-Za-z0-9-]+\\.)*${escapeRe(d)}`, 'gi'), '[INTERNAL]');
  }
  for (const t of opts.denyTerms ?? []) {
    if (t.trim()) apply('deny_term', new RegExp(escapeRe(t.trim()), 'gi'), '[REDACTED]');
  }
  return { text, redactions };
}
