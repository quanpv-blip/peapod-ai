import { describe, expect, it } from 'vitest';
import type { ContentPackage } from '../src/domain/package.ts';
import { feedPost, isDefinitiveRejection, scheduleGate } from '../src/domain/publish.ts';
import { pagesFromEnv } from '../src/services/publish.ts';

const pkg: ContentPackage = {
  market: 'VN',
  topic_summary: 't',
  post: { headline: 'Tiêu đề', body: 'Thân bài tiếng Việt.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#A', '#B'] },
  sources: [{ title: 'Nguồn', url: 'https://example.com/a' }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
};

describe('nội dung đăng', () => {
  it('ghép tiêu đề, thân, CTA, hashtag; nguồn là liên kết', () => {
    const p = feedPost(pkg);
    expect(p.message).toBe('Tiêu đề\n\nThân bài tiếng Việt.\n\nBạn nghĩ sao?\n\n#A #B');
    expect(p.link).toBe('https://example.com/a');
  });
});

describe('cổng giờ đăng', () => {
  const now = new Date('2030-01-01T00:00:00Z');
  const at = (min: number) => new Date(now.getTime() + min * 60_000);
  it('dưới 15 phút: từ chối với lý do rõ ràng', () => {
    const g = scheduleGate(at(10), now);
    expect(g.ok).toBe(false);
    if (!g.ok) expect(g.reason).toContain('15 phút');
  });
  it('trên 29 ngày: từ chối', () => {
    expect(scheduleGate(at(30 * 24 * 60), now).ok).toBe(false);
  });
  it('trong khoảng: chấp nhận', () => {
    expect(scheduleGate(at(60), now).ok).toBe(true);
  });
});

describe('phân loại lỗi Meta', () => {
  it('4xx trừ 408/429 là từ chối xác định', () => {
    expect(isDefinitiveRejection(400)).toBe(true);
    expect(isDefinitiveRejection(403)).toBe(true);
    expect(isDefinitiveRejection(429)).toBe(false);
    expect(isDefinitiveRejection(408)).toBe(false);
  });
  it('5xx và lỗi mạng là không rõ kết quả', () => {
    expect(isDefinitiveRejection(500)).toBe(false);
    expect(isDefinitiveRejection(503)).toBe(false);
  });
});

describe('cấu hình Trang từ biến môi trường', () => {
  it('chỉ lấy thị trường có đủ cả ID và token', () => {
    const p = pagesFromEnv({ FB_VN_PAGE_ID: '1', FB_VN_PAGE_TOKEN: 't', FB_JP_PAGE_ID: '2' });
    expect(Object.keys(p)).toEqual(['VN']);
    expect(p.VN).toEqual({ id: '1', token: 't' });
  });
});
