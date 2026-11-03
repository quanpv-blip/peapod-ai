import { describe, expect, it } from 'vitest';
import { NEWS_VOICE, newsUserPrompt, unusedItems } from '../src/domain/editorial.ts';

describe('biên tập bản tin', () => {
  it('bỏ mục đã dùng theo URL nguồn', () => {
    const items = [
      { title: 'A', url: 'https://x.test/a', summary: '' },
      { title: 'B', url: 'https://x.test/b', summary: '' },
    ];
    expect(unusedItems(items, new Set(['https://x.test/a'])).map((i) => i.title)).toEqual(['B']);
  });

  it('văn phong JP theo cấu trúc tin, không bán hàng cứng', () => {
    const voice = NEWS_VOICE.JP;
    expect(voice).toContain('出典');
    expect(voice).toContain('当社の見方');
    expect(voice).toContain('お問い合わせ'); // nằm trong danh sách cấm
    expect(voice).toMatch(/Không dùng:[^\n]*お問い合わせ/);
  });

  it('prompt chỉ chứa đúng một mục brief và yêu cầu ảnh thẻ', () => {
    const p = newsUserPrompt('VN', '1. Tin A\n   URL: https://x.test/a');
    expect(p).toContain('REMOTION_CARD');
    expect(p).toContain('https://x.test/a');
  });
});
