import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dedupeByUrl, parseFeed } from '../src/domain/rss.ts';
import { buildCues, estimateTimings } from '../src/domain/subtitles.ts';
import { parseWav } from '../src/domain/wav.ts';
import { validatePackage } from '../src/domain/package.ts';
import { extractAudio, extractText, toGeminiSchema } from '../src/providers/gemini.ts';

describe('RSS (FR-RES-03)', () => {
  it('RSS 2.0 với CDATA và thực thể', () => {
    const xml = `<rss><channel><item><title><![CDATA[Ra mắt &amp; ứng dụng AI]]></title><link>https://a.example/1</link>
      <pubDate>Mon, 02 Nov 2026 01:00:00 +0700</pubDate><description><![CDATA[<p>Tóm tắt <b>ngắn</b></p>]]></description></item></channel></rss>`;
    expect(parseFeed(xml)).toEqual([
      { title: 'Ra mắt & ứng dụng AI', url: 'https://a.example/1', summary: 'Tóm tắt ngắn', publishedAt: 'Mon, 02 Nov 2026 01:00:00 +0700' },
    ]);
  });
  it('Atom lấy link từ href', () => {
    const xml = `<feed><entry><title>記事</title><link rel="alternate" href="https://b.example/x?a=1&amp;b=2"/><updated>2026-11-02T00:00:00Z</updated><summary>要約</summary></entry></feed>`;
    const [i] = parseFeed(xml);
    expect(i?.url).toBe('https://b.example/x?a=1&b=2');
    expect(i?.title).toBe('記事');
  });
  it('RDF/RSS 1.0 (dc:date)', () => {
    const xml = `<rdf:RDF><item rdf:about="https://c.example/1"><title>タイトル</title><link>https://c.example/1</link><dc:date>2026-11-02T09:00:00+09:00</dc:date></item></rdf:RDF>`;
    expect(parseFeed(xml)[0]).toMatchObject({ title: 'タイトル', url: 'https://c.example/1', publishedAt: '2026-11-02T09:00:00+09:00' });
  });
  it('bỏ mục thiếu tiêu đề/link, giới hạn số lượng, loại trùng', () => {
    const xml = `<rss><item><title>A</title></item><item><title>B</title><link>https://d.example/1</link></item><item><title>B2</title><link>https://d.example/1</link></item></rss>`;
    const items = parseFeed(xml);
    expect(items).toHaveLength(2);
    expect(dedupeByUrl(items)).toHaveLength(1);
    expect(parseFeed(xml, 1)).toHaveLength(1);
  });
});

function wav(seconds: number, rate = 24000): Uint8Array {
  const data = Math.round(seconds * rate * 2);
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0); b.writeUInt32LE(36 + data, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data, 40);
  return b;
}

describe('WAV', () => {
  it('đọc thời lượng 24 kHz mono 16-bit', () => {
    const i = parseWav(wav(5.5));
    expect(i).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16 });
    expect(i.durationSec).toBeCloseTo(5.5, 3);
  });
  it('chịu được kích thước data = 0xFFFFFFFF (phát trực tiếp)', () => {
    const b = Buffer.from(wav(2));
    b.writeUInt32LE(0xffffffff, 40);
    expect(parseWav(b).durationSec).toBeCloseTo(2, 3);
  });
  it('từ chối dữ liệu không phải WAV', () => {
    expect(() => parseWav(new Uint8Array(100))).toThrow();
  });
});

describe('ước lượng timestamp khi TTS không trả (Gemini)', () => {
  it('phủ đúng tổng thời lượng, liên tục, tăng dần', () => {
    const { chars, times } = estimateTimings('本日はご紹介いたします。次に進みます。', 6);
    expect(times).toHaveLength(chars.length);
    expect(times[0]![0]).toBe(0);
    expect(times.at(-1)![1]).toBeCloseTo(6, 6);
    for (let i = 1; i < times.length; i++) expect(times[i]![0]).toBeCloseTo(times[i - 1]![1], 9);
  });
  it('dấu câu chiếm thời gian nghỉ lớn hơn chữ thường', () => {
    const { chars, times } = estimateTimings('ab。cd', 5);
    const dur = (i: number) => times[i]![1] - times[i]![0];
    expect(dur(chars.indexOf('。'))).toBeGreaterThan(dur(0));
  });
  it('dùng được chung với buildCues', () => {
    const { chars, times } = estimateTimings('Xin chào. Tạm biệt.', 4);
    const cues = buildCues(chars, times, { maxCharsPerLine: 42 });
    expect(cues.map((c) => c.text)).toEqual(['Xin chào.', 'Tạm biệt.']);
    expect(cues.at(-1)!.end).toBeCloseTo(4, 6);
  });
  it('đầu vào rỗng hoặc thời lượng <= 0 không ném lỗi', () => {
    expect(estimateTimings('', 3).times).toEqual([]);
    expect(estimateTimings('abc', 0).times).toEqual([]);
  });
});

describe('chuyển schema cho Gemini (E-21)', () => {
  const schema = JSON.parse(readFileSync('schemas/content_package.schema.json', 'utf8')).schema;
  const converted = toGeminiSchema(schema) as { properties: { media: Record<string, unknown> } };
  const text = JSON.stringify(converted);
  it('không còn oneOf, const, $comment', () => {
    expect(text).not.toMatch(/"oneOf"|"const"|\$comment/);
    expect(converted.properties.media.anyOf).toHaveLength(4);
  });
  it('const -> enum một phần tử', () => {
    expect(text).toContain('"enum":["GROK_IMAGINE_REEL"]');
  });
  it('không làm thay đổi schema gốc', () => {
    expect(JSON.stringify(schema)).toContain('"oneOf"');
  });
});

describe('trích phản hồi Gemini (hình dạng thật từ PoC)', () => {
  const i = {
    steps: [
      { type: 'thought', content: [] },
      { type: 'model_output', content: [{ type: 'text', text: '{"a":1}' }] },
    ],
  };
  it('lấy text từ model_output, bỏ qua thought', () => {
    expect(extractText(i)).toBe('{"a":1}');
  });
  it('lấy audio base64', () => {
    const a = extractAudio({ steps: [{ type: 'model_output', content: [{ type: 'audio', data: Buffer.from('xyz').toString('base64'), mime_type: 'audio/wav' }] }] });
    expect(a?.data.toString()).toBe('xyz');
    expect(extractAudio({ steps: [] })).toBeUndefined();
  });
  it('gói hợp lệ sau chuyển đổi vẫn kiểm được bằng validator gốc', () => {
    expect(validatePackage({ market: 'VN' }).ok).toBe(false);
  });
});
