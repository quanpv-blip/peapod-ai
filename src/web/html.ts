// Dựng HTML phía máy chủ. MỌI giá trị chèn vào đều đi qua esc(): nội dung do AI/RSS sinh ra là dữ liệu không tin cậy (chống XSS).

const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => MAP[c]!);

/** Đánh dấu chuỗi đã là HTML an toàn (do chính mã này dựng), tránh escape hai lần. */
export class Safe {
  constructor(readonly html: string) {}
  toString(): string {
    return this.html;
  }
}
export const raw = (s: string) => new Safe(s);
export const empty = new Safe('');

const part = (v: unknown): string => (v instanceof Safe ? v.html : Array.isArray(v) ? v.map(part).join('') : esc(v));

/** Thẻ template: giá trị thường được escape; Safe và mảng Safe được giữ nguyên. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Safe {
  let out = strings[0] ?? '';
  values.forEach((v, i) => {
    out += part(v) + (strings[i + 1] ?? '');
  });
  return new Safe(out);
}
