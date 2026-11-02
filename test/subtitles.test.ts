import { describe, expect, it } from 'vitest';
import { buildCues, toSrt } from '../src/domain/subtitles.ts';

const mk = (text: string, step = 0.1) => {
  const chars = [...text];
  return { chars, times: chars.map((_, i) => [i * step, (i + 1) * step] as [number, number]) };
};

describe('phụ đề từ timestamp TTS', () => {
  it('tách theo câu và giữ đúng thời điểm', () => {
    const { chars, times } = mk('Xin chào. Tạm biệt.');
    const cues = buildCues(chars, times, { maxCharsPerLine: 42 });
    expect(cues.map((c) => c.text)).toEqual(['Xin chào.', 'Tạm biệt.']);
    expect(cues[0]!.start).toBeCloseTo(0);
    expect(cues[0]!.end).toBeCloseTo(0.9);
    expect(cues[1]!.start).toBeCloseTo(1.0);
  });
  it('tách câu tiếng Nhật theo dấu 。', () => {
    const { chars, times } = mk('本日は品質管理です。保守運用も支援します。');
    const cues = buildCues(chars, times, { maxCharsPerLine: 18 });
    expect(cues).toHaveLength(2);
    expect(cues[0]!.text).toBe('本日は品質管理です。');
  });
  it('cắt câu dài, không mất chữ, không chồng lấn thời gian', () => {
    const long = 'Chúng tôi cung cấp dịch vụ bảo trì hệ thống, giám sát liên tục, vá lỗi bảo mật, tối ưu hiệu năng và hỗ trợ khách hàng mọi lúc';
    const { chars, times } = mk(long);
    const cues = buildCues(chars, times, { maxCharsPerLine: 30, maxLines: 2 });
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0]!.text.replace('\n', ' ')).toMatch(/hệ thống,$/); // ngắt ở dấu phẩy, không cắt giữa "liên tục"
    for (const c of cues) {
      expect(c.text.split('\n').length).toBeLessThanOrEqual(2);
      expect(c.end).toBeGreaterThan(c.start);
    }
    expect(cues.map((c) => c.text.replace(/\s/g, '')).join('')).toBe(long.replace(/\s/g, ''));
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.end - 1e-9);
  });
  it('ném lỗi khi độ dài không khớp', () => {
    expect(() => buildCues(['a'], [], { maxCharsPerLine: 10 })).toThrow();
  });
  it('xuất SRT đúng định dạng', () => {
    const srt = toSrt([
      { start: 0, end: 1.5, text: 'A' },
      { start: 3661.25, end: 3662, text: 'B' },
    ]);
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,500\nA\n\n2\n01:01:01,250 --> 01:01:02,000\nB\n');
  });
});
