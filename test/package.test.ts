import { describe, expect, it } from 'vitest';
import { languageMatchesMarket, packageHash, unknownSources, validatePackage, type ContentPackage } from '../src/domain/package.ts';

const base = (media: unknown, market: 'VN' | 'JP' = 'VN') => ({
  market,
  topic_summary: 'Tóm tắt',
  post: { headline: 'Tiêu đề', body: 'Nội dung bài viết', call_to_action: 'Liên hệ', hashtags: ['#it'] },
  sources: [{ title: 'Nguồn', url: 'https://example.com/a' }],
  claims_to_verify: [] as string[],
  media,
});

describe('schema content_package', () => {
  it('chấp nhận từng engine hợp lệ', () => {
    const ok = [
      { engine: 'NONE' },
      { engine: 'REMOTION_CARD', card: { title: 'T', bullets: ['a'] } },
      {
        engine: 'REMOTION_VIDEO',
        voiceover_script: 'x',
        scenes: [
          { title: 'a', bullets: [], voiceover_segment: 'x' },
          { title: 'b', bullets: ['y'], voiceover_segment: 'z' },
        ],
      },
      { engine: 'GROK_IMAGINE_REEL', visual_prompt_en: 'A server room', voiceover_script: 'xin chào' },
    ];
    for (const m of ok) expect(validatePackage(base(m)).ok, JSON.stringify(m)).toBe(true);
  });
  it('từ chối thiếu trường theo engine', () => {
    expect(validatePackage(base({ engine: 'REMOTION_CARD' })).ok).toBe(false);
    expect(validatePackage(base({ engine: 'GROK_IMAGINE_REEL', visual_prompt_en: 'x' })).ok).toBe(false);
  });
  it('từ chối engine lạ và trường thừa', () => {
    expect(validatePackage(base({ engine: 'MAGIC' })).ok).toBe(false);
    expect(validatePackage(base({ engine: 'NONE', extra: 1 })).ok).toBe(false);
  });
  it('bắt buộc có nguồn và thị trường hợp lệ', () => {
    expect(validatePackage({ ...base({ engine: 'NONE' }), sources: [] }).ok).toBe(false);
    expect(validatePackage({ ...base({ engine: 'NONE' }), market: 'US' }).ok).toBe(false);
  });
  it('giới hạn độ dài thân bài', () => {
    const p = base({ engine: 'NONE' });
    p.post.body = 'x'.repeat(2001);
    expect(validatePackage(p).ok).toBe(false);
  });
});

describe('băm và nguồn', () => {
  it('hash không phụ thuộc thứ tự khóa', () => {
    expect(packageHash({ a: 1, b: { c: 2, d: 3 } })).toBe(packageHash({ b: { d: 3, c: 2 }, a: 1 }));
    expect(packageHash({ a: 1 })).not.toBe(packageHash({ a: 2 }));
  });
  it('phát hiện URL nguồn không có trong brief', () => {
    const pkg = base({ engine: 'NONE' }) as unknown as ContentPackage;
    pkg.sources = [
      { title: 'a', url: 'https://example.com/a/' },
      { title: 'b', url: 'https://fake.example.org/x' },
    ];
    expect(unknownSources(pkg, ['https://example.com/a#frag'])).toEqual(['https://fake.example.org/x']);
  });
});

describe('ngôn ngữ đúng thị trường', () => {
  it('JP cần chữ Nhật, VN thì không', () => {
    expect(languageMatchesMarket('本日はオフショア開発についてご紹介いたします。', 'JP')).toBe(true);
    expect(languageMatchesMarket('Hôm nay chúng tôi giới thiệu giải pháp', 'JP')).toBe(false);
    expect(languageMatchesMarket('Hôm nay chúng tôi giới thiệu giải pháp', 'VN')).toBe(true);
    expect(languageMatchesMarket('本日はご紹介いたします', 'VN')).toBe(false);
  });
});
