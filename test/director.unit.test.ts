import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { directorFix, directorSystem, quoteIssues } from '../src/domain/director.ts';
import { AiUnavailableError } from '../src/providers/aiChain.ts';
import { worthRetry } from '../src/services/reels.ts';

describe('đạo diễn AI: kiểm câu trích', () => {
  const src = 'Carrefour cho biết 15 trong số 700 cửa hàng của họ tại Bỉ bị ảnh hưởng.\nÔng ước tính thiệt hại 15.000 euro.';
  it('câu chép nguyên văn (khác khoảng trắng/xuống dòng) là đạt', () => {
    expect(quoteIssues({ scenes: [], facts: [{ id: 'a', raw: '700', quote: 'Carrefour cho biết 15 trong số   700 cửa hàng của họ tại Bỉ bị ảnh hưởng.' }] }, src)).toEqual([]);
  });
  it('câu diễn đạt lại bị bắt', () => {
    expect(quoteIssues({ scenes: [], facts: [{ id: 'a', raw: '15', quote: 'Carrefour có 15 cửa hàng bị ảnh hưởng.' }] }, src)[0]).toMatch(/nguyên văn/);
  });
  it('raw không nằm trong chính câu trích bị bắt', () => {
    expect(quoteIssues({ scenes: [], facts: [{ id: 'a', raw: '20', quote: 'Ông ước tính thiệt hại 15.000 euro.' }] }, src)[0]).toMatch(/raw/);
  });
  it('prompt nêu luật con số và có prompt sửa kèm danh sách lỗi', () => {
    expect(directorSystem('VN')).toMatch(/NGUYÊN VĂN/);
    expect(directorSystem('JP')).toMatch(/一字一句/);
    expect(directorFix({ scenes: [] }, ['lỗi A'], 'VN')).toContain('1. lỗi A');
  });
  it('lược đồ storyboard có trong schemas/ (đồng bộ từ peapod-video), bắt buộc "items" ở mọi cảnh', () => {
    const s = JSON.parse(readFileSync(new URL('../schemas/storyboard.schema.json', import.meta.url), 'utf8'));
    expect(s.properties.scenes.items.properties.type.enum).toContain('hook');
    expect(s.properties.scenes.items.required).toContain('items');
    expect(JSON.stringify(s)).not.toMatch(/maxLength|pattern|description/); // Gemini từ chối lược đồ nhiều ràng buộc
  });

  it('ví dụ trong prompt đúng hình dạng lược đồ và đúng luật từng loại cảnh (ví dụ sai sẽ dạy AI viết sai)', () => {
    const schema = JSON.parse(readFileSync(new URL('../schemas/storyboard.schema.json', import.meta.url), 'utf8'));
    const scene = schema.properties.scenes.items;
    const MIN: Record<string, number> = { cards: 2, compare: 2, bullets: 2, checklist: 3, timeline: 2, process: 2, alert: 1, recap: 2 };
    for (const m of ['VN', 'JP'] as const) {
      const sys = directorSystem(m);
      const ex = JSON.parse(sys.slice(sys.lastIndexOf('\n') + 1)) as { facts: { id: string }[]; scenes: Record<string, unknown>[] };
      const ids = new Set(ex.facts.map((f) => f.id));
      expect(ex.scenes[0]!.type).toBe('hook');
      expect(ex.scenes.at(-1)!.type).toBe('cta');
      for (const sc of ex.scenes) {
        for (const k of scene.required) expect(sc, `${m} ${String(sc.type)} thiếu ${k}`).toHaveProperty(k);
        for (const k of Object.keys(sc)) expect(Object.keys(scene.properties), `${m}: trường lạ ${k}`).toContain(k);
        expect(scene.properties.type.enum).toContain(sc.type);
        const items = sc.items as { text?: string; factId?: string }[];
        const min = MIN[String(sc.type)];
        if (min) expect(items.length, `${m} ${String(sc.type)} cần ≥ ${min} mục`).toBeGreaterThanOrEqual(min);
        if (sc.factId) expect(ids.has(String(sc.factId))).toBe(true);
        if (min && sc.type !== 'cards' && sc.type !== 'compare') for (const it of items) expect(it.text?.trim()).toBeTruthy();
      }
    }
  });
});

describe('khi nào tự thử lại đạo diễn AI', () => {
  const e = (...r: string[]) => new AiUnavailableError(r);
  it('quá tải / quá chậm: thử lại', () => {
    expect(worthRetry(e('a: đang quá tải', 'b: phản hồi quá chậm'))).toBe(true);
  });
  it('một mô hình hết hạn mức, các mô hình khác quá tải (đúng ca bài #27): vẫn thử lại', () => {
    expect(worthRetry(e('3.8: đang quá tải', '3.7: phản hồi quá chậm', '3.6: hết hạn mức trong ngày', '3.5: đang quá tải'))).toBe(true);
  });
  it('mọi mô hình hết hạn mức, hoặc có lỗi từ chối/khóa sai, hoặc lỗi khác: không thử lại', () => {
    expect(worthRetry(e('a: hết hạn mức trong ngày', 'b: hết hạn mức trong ngày'))).toBe(false);
    expect(worthRetry(e('a: đang quá tải', 'b: từ chối yêu cầu (lược đồ hoặc nội dung không hợp lệ)'))).toBe(false);
    expect(worthRetry(e('a: đang quá tải', 'b: khóa API không hợp lệ hoặc không có quyền'))).toBe(false);
    expect(worthRetry(new Error('x'))).toBe(false);
  });
});

describe('thẻ nguồn: tên báo', () => {
  const p = (title: string, url = 'https://www.vnexpress.net/a') => ({ market: 'VN' as const, topic_summary: '', post: { headline: '', body: '', call_to_action: '', hashtags: [] }, sources: [{ title, url }], claims_to_verify: [], media: { engine: 'NONE' as const } });
  it('sources[0].title ngắn là tên báo; dài như tiêu đề bài thì dùng tên miền bỏ www.', async () => {
    const { outletName } = await import('../src/services/storyReel.ts');
    expect(outletName(p('VnExpress'))).toBe('VnExpress');
    expect(outletName(p('Hacker tăng nhiệt tủ lạnh đến 50 độ C tại hàng loạt siêu thị châu Âu'))).toBe('vnexpress.net');
  });
});
