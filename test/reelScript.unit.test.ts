import { describe, expect, it } from 'vitest';
import { buildReelCaptions, chooseTemplate, voiceDurationOk, voiceScript } from '../src/domain/reelScript.ts';
import type { ContentPackage } from '../src/domain/package.ts';

const pkg = (headline: string, body = 'Nội dung bình thường.'): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline, body, call_to_action: 'x?', hashtags: [] },
  sources: [{ title: 's', url: 'https://example.com/a' }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});

describe('chọn mẫu bố cục', () => {
  it('tin sự cố bảo mật dùng mẫu alert', () => {
    expect(chooseTemplate(pkg('Lộ dữ liệu khách hàng tại công ty X'), ['a', 'b', 'c'])).toBe('alert');
  });
  it('tiếng Nhật: 不正アクセス dùng alert', () => {
    expect(chooseTemplate(pkg('不正アクセスの被害'), ['a', 'b', 'c'])).toBe('alert');
  });
  it('ít ý (≤ 2) dùng focus, từ 3 ý dùng list', () => {
    expect(chooseTemplate(pkg('Tin thường'), ['một', 'hai'])).toBe('focus');
    expect(chooseTemplate(pkg('Tin thường'), ['một', 'hai', 'ba'])).toBe('list');
  });
});

describe('lời đọc', () => {
  it('thêm dấu chấm cuối câu và ghép theo thứ tự tiêu đề, ý, nhận định', () => {
    const s = voiceScript('Tiêu đề', ['Ý một', 'Ý hai.'], 'Nhận định', 'VN');
    expect(s).toBe('Tiêu đề. Ý một. Ý hai. Nhận định.');
  });
  it('tiếng Nhật ghép liền, dùng 。', () => {
    expect(voiceScript('見出し', ['一つ目'], null, 'JP')).toBe('見出し。一つ目。');
  });
  it('quá dài thì bỏ bớt phần cuối nhưng giữ tiêu đề và ít nhất một ý', () => {
    const long = 'x'.repeat(400);
    const s = voiceScript('Tiêu đề', [long, long, long], long, 'VN');
    expect(s.startsWith('Tiêu đề.')).toBe(true);
    expect([...s].length).toBeLessThanOrEqual(1200);
    expect(s).toContain(long);
  });
});

describe('phụ đề', () => {
  it('phủ toàn bộ thời lượng và không vượt quá', () => {
    const script = 'Chuyển động nổi bật ngành chip. FPT vận hành nhà máy kiểm thử chip tại Bắc Ninh. Chuỗi giá trị đang mở rộng nhanh.';
    const cues = buildReelCaptions(script, 12, 'VN');
    expect(cues.length).toBeGreaterThan(1);
    expect(cues[0]!.start).toBeLessThan(0.5);
    expect(cues.at(-1)!.end).toBeLessThanOrEqual(12.01);
    for (let i = 1; i < cues.length; i++) expect(cues[i]!.start).toBeGreaterThanOrEqual(cues[i - 1]!.start);
    for (const c of cues) expect(c.text.length).toBeLessThanOrEqual(120);
  });
  it('mỗi dòng phụ đề tiếng Nhật không dài quá giới hạn', () => {
    const cues = buildReelCaptions('セキュリティ基盤の信頼性を維持するため、定期的な確認が重要です。今後も動向を注視します。', 10, 'JP');
    for (const c of cues) for (const line of c.text.split('\n')) expect([...line].length).toBeLessThanOrEqual(34);
  });
  it('thời lượng 0 thì không có phụ đề', () => {
    expect(buildReelCaptions('abc', 0, 'VN')).toEqual([]);
  });
});

describe('thời lượng hợp lệ', () => {
  it('3–90 giây', () => {
    expect(voiceDurationOk(2)).toBe(false);
    expect(voiceDurationOk(20)).toBe(true);
    expect(voiceDurationOk(91)).toBe(false);
    expect(voiceDurationOk(Number.NaN)).toBe(false);
  });
});
