import { describe, expect, it } from 'vitest';
import { campaignSourceAllowed, DEFAULT_SETTINGS, parseSettings, settingsToForm } from '../src/domain/appSettings.ts';
import { diffPackages, lineDiff } from '../src/domain/diff.ts';
import type { ContentPackage } from '../src/domain/package.ts';
import { bucUsagePct } from '../src/domain/publish.ts';
import { estimateCost } from '../src/services/costs.ts';
import { localClock } from '../src/jobs/cycle.ts';
import { renderCard } from '../src/media/card.ts';

const pkg = (over: Partial<ContentPackage['post']> = {}): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline: 'Tiêu đề', body: 'Dòng một\nDòng hai', call_to_action: 'Ok', hashtags: ['#A'], ...over },
  sources: [{ title: 'Nguồn', url: 'https://example.com/a' }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});

describe('so sánh bản sửa', () => {
  it('giữ các dòng chung, đánh dấu thêm và bớt', () => {
    const d = lineDiff(['a', 'b', 'c'], ['a', 'x', 'c', 'd']);
    expect(d.map((o) => `${o.type}:${o.text}`)).toEqual(['eq:a', 'del:b', 'add:x', 'eq:c', 'add:d']);
  });
  it('báo thay đổi theo từng trường nội dung', () => {
    const r = diffPackages(pkg(), pkg({ headline: 'Tiêu đề mới' }));
    expect(r.changed).toBe(true);
    expect(r.headline.some((o) => o.type === 'del' && o.text === 'Tiêu đề')).toBe(true);
    expect(diffPackages(pkg(), pkg()).changed).toBe(false);
  });
});

describe('lượt gọi Meta (BUC)', () => {
  it('lấy chỉ số cao nhất trong header; thiếu hoặc hỏng thì 0', () => {
    const h = JSON.stringify({ '123': [{ call_count: 42, total_cputime: 10, total_time: 75 }] });
    expect(bucUsagePct(h)).toBe(75);
    expect(bucUsagePct(null)).toBe(0);
    expect(bucUsagePct('không phải json')).toBe(0);
  });
});

describe('cấu hình vận hành', () => {
  it('mặc định hợp lệ và điền lại được form', () => {
    const form = settingsToForm(DEFAULT_SETTINGS);
    const r = parseSettings(form);
    expect(r.ok).toBe(true);
  });
  it('gom mọi lỗi: giờ sai, URL không https, trần âm', () => {
    const form = { ...settingsToForm(DEFAULT_SETTINGS), genTimeVN: '25:00', feedsJP: 'http://insecure.test/rss', dailyCapUsd: '-1' };
    const r = parseSettings(form);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.join(' | ')).toContain('HH:MM');
      expect(r.errors.join(' | ')).toContain('https');
      expect(r.errors.join(' | ')).toContain('Trần ngày');
    }
  });
  it('miền nguồn chiến dịch: https và thuộc miền được phép (cả tên miền con)', () => {
    const d = ['vnexpress.net'];
    expect(campaignSourceAllowed('https://vnexpress.net/a', d)).toBe(true);
    expect(campaignSourceAllowed('https://so.vnexpress.net/a', d)).toBe(true);
    expect(campaignSourceAllowed('http://vnexpress.net/a', d)).toBe(false);
    expect(campaignSourceAllowed('https://evil-vnexpress.net/a', d)).toBe(false);
    expect(campaignSourceAllowed('không phải url', d)).toBe(false);
  });
});

describe('chi phí và múi giờ', () => {
  it('chi phí: token suy luận tính như token ra', () => {
    const c = estimateCost({ inputTokens: 1_000_000, outputTokens: 500_000, thoughtTokens: 500_000 }, { priceInPerM: 1, priceOutPerM: 2 });
    expect(c).toBeCloseTo(1 + 2, 6);
  });
  it('giờ và ngày theo múi giờ thị trường', () => {
    // 2026-11-03 17:30 UTC = 00:30 ngày 04/11 ở Việt Nam, 02:30 ngày 04/11 ở Nhật.
    const t = new Date('2026-11-03T17:30:00Z');
    expect(localClock('VN', t)).toEqual({ hhmm: '00:30', day: '2026-11-04' });
    expect(localClock('JP', t)).toEqual({ hhmm: '02:30', day: '2026-11-04' });
  });
});

describe('ảnh thẻ', () => {
  it('dựng PNG 1080x1350 có chữ tiếng Việt và tiếng Nhật', async () => {
    const png = await renderCard({ market: 'JP', title: '【ニュース】テスト ệ ộ', bullets: ['一つ目', 'Hai'], source: 'テスト', date: '03/11/2026' });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1350);
  }, 60_000);
});
