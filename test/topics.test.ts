import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { DEFAULT_SETTINGS, settingsToForm } from '../src/domain/appSettings.ts';
import { scoreItems, topicTerms, type SourceItem } from '../src/services/sources.ts';
import { validTopics } from '../src/services/topics.ts';
import { saveAppSettings } from '../src/services/appSettings.ts';
import { generateTopic } from '../src/services/generate.ts';
import { refreshSources, recentItems } from '../src/services/sources.ts';
import { suggestTopics } from '../src/services/topics.ts';
import type { GeminiClient } from '../src/providers/gemini.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql', '007_source_items.sql'];
const schema = JSON.parse(readFileSync(new URL('../schemas/content_package.schema.json', import.meta.url), 'utf8')).schema as object;
const MEDIA = '/tmp/pp-topics-media';

const item = (title: string, url: string, summary = ''): SourceItem => ({ id: 0, market: 'VN', feed: 'vnexpress.net', url, title, summary, published_at: null });

describe('từ khóa và chấm điểm (thuần)', () => {
  it('tách từ khóa, bỏ từ nối và từ quá ngắn', () => {
    expect(topicTerms('Chip bán dẫn và AI')).toEqual(['chip', 'bán', 'dẫn', 'ai']);
    expect(topicTerms('a của')).toEqual([]);
  });
  it('tin khớp tiêu đề được xếp trước tin chỉ khớp tóm tắt; tin không khớp bị loại', () => {
    const pool = [item('Tin khác hoàn toàn', 'https://vnexpress.net/1', 'chip'), item('Chip mới ra mắt', 'https://vnexpress.net/2'), item('Thời tiết', 'https://vnexpress.net/3')];
    const r = scoreItems(pool, 'chip', 5);
    expect(r.map((x) => x.url)).toEqual(['https://vnexpress.net/2', 'https://vnexpress.net/1']);
  });
});

describe('lọc đề xuất của mô hình (thuần)', () => {
  const known = new Set(['https://vnexpress.net/a', 'https://vnexpress.net/b']);
  it('chỉ giữ URL có trong kho; bỏ chủ đề không còn URL hợp lệ', () => {
    const r = validTopics(
      [
        { title: 'Chủ đề A', reason: 'lý do', urls: ['https://vnexpress.net/a', 'https://lạ.test/x'] },
        { title: 'Chủ đề bịa', reason: 'lý do', urls: ['https://lạ.test/y'] },
        { title: 'Thiếu trường' },
      ],
      known,
    );
    expect(r).toEqual([{ title: 'Chủ đề A', reason: 'lý do', urls: ['https://vnexpress.net/a'] }]);
  });
  it('đầu vào không phải mảng thì trả rỗng', () => {
    expect(validTopics('không phải mảng', known)).toEqual([]);
  });
});

d('đề xuất và tạo bài theo chủ đề (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    const f = await freshDb(URL_!, MIGRATIONS);
    db = f.db;
    drop = f.drop;
  });
  afterAll(async () => {
    await drop?.();
  });
  beforeEach(async () => {
    await db.query('DELETE FROM app_config');
    await db.query('DELETE FROM source_item');
    await db.query('DELETE FROM ai_usage');
    await db.query('DELETE FROM media_asset');
    await db.query('DELETE FROM approval_event');
    await db.query('DELETE FROM content_revision');
    await db.query('DELETE FROM content_item');
    await saveAppSettings(db, settingsToForm(DEFAULT_SETTINGS), 'admin@t');
  });

  async function seedItems(): Promise<void> {
    const fetchFake = async () => [
      { title: 'Chip bán dẫn Việt Nam mở nhà máy mới', url: 'https://vnexpress.net/chip-1', summary: 'Nhà máy thử nghiệm chip tại Bắc Ninh.', publishedAt: new Date().toISOString() },
      { title: 'Doanh nghiệp AI ra mắt trợ lý mới', url: 'https://vnexpress.net/ai-2', summary: 'Trợ lý dùng mô hình ngôn ngữ.', publishedAt: new Date().toISOString() },
      { title: 'Chip thế hệ mới giảm tiêu thụ điện', url: 'https://vnexpress.net/chip-3', summary: 'Tiết kiệm năng lượng cho trung tâm dữ liệu.', publishedAt: new Date().toISOString() },
    ];
    expect(await refreshSources(db, 'VN', ['https://vnexpress.net/rss'], fetchFake)).toBe(3);
  }

  it('làm mới kho tin rồi tìm tin theo chủ đề', async () => {
    await seedItems();
    const pool = await recentItems(db, 'VN', new Date(), 3, 50);
    expect(pool.length).toBe(3);
    expect(scoreItems(pool, 'chip bán dẫn', 3).map((x) => x.url)).toContain('https://vnexpress.net/chip-1');
  });

  it('không có tin khớp thì bỏ qua với lý do rõ ràng, không gọi AI', async () => {
    await seedItems();
    const gemini = { generateJson: vi.fn() } as unknown as GeminiClient;
    const r = await generateTopic({ db, gemini, schema, mediaDir: MEDIA }, { market: 'VN', topic: 'bóng đá world cup', model: 'm' });
    expect(r.outcome).toBe('skipped');
    expect(r.detail).toContain('Không có tin liên quan');
    expect(gemini.generateJson).not.toHaveBeenCalled();
  });

  it('tạo bài từ nhiều tin liên quan; nguồn lạ bị loại', async () => {
    await seedItems();
    const pkg = {
      market: 'VN',
      topic_summary: 'chip',
      post: { headline: 'Chip Việt Nam tiến thêm một bước', body: 'Nhà máy chip mới mở tại Bắc Ninh và một thế hệ chip tiết kiệm điện đang được giới thiệu.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#chip'] },
      sources: [{ title: 'VnExpress', url: 'https://vnexpress.net/chip-1' }, { title: 'VnExpress', url: 'https://vnexpress.net/chip-3' }],
      claims_to_verify: [],
      media: { engine: 'NONE' },
    };
    const gemini = { generateJson: vi.fn(async () => ({ json: pkg, usage: { inputTokens: 100, outputTokens: 50, thoughtTokens: 0 }, text: '', raw: null })) } as unknown as GeminiClient;
    const r = await generateTopic({ db, gemini, schema, mediaDir: MEDIA }, { market: 'VN', topic: 'chip', model: 'm' });
    expect(r.outcome).toBe('created');
    const sent = (gemini.generateJson as unknown as { mock: { calls: { user: string }[][] } }).mock.calls[0]![0]!.user;
    expect(sent).toContain('https://vnexpress.net/chip-1');
    expect(sent).toContain('Chủ đề người duyệt chọn');

    const bad = { ...pkg, sources: [{ title: 'X', url: 'https://khac.test/z' }] };
    const gemini2 = { generateJson: vi.fn(async () => ({ json: bad, usage: { inputTokens: 1, outputTokens: 1, thoughtTokens: 0 }, text: '', raw: null })) } as unknown as GeminiClient;
    const r2 = await generateTopic({ db, gemini: gemini2, schema, mediaDir: MEDIA }, { market: 'VN', topic: 'chip', model: 'm' });
    expect(r2.outcome).toBe('skipped');
    expect(r2.detail).toContain('nguồn');
  });

  it('đề xuất: không có AI thì rơi về tin mới nhất; có AI thì chỉ giữ URL trong kho', async () => {
    await seedItems();
    const fallback = await suggestTopics({ db, model: 'm' }, 'VN');
    expect(fallback.source).toBe('tin-mới');
    expect(fallback.topics.length).toBe(3);

    const gemini = {
      generateJson: vi.fn(async () => ({
        json: { topics: [{ title: 'Chip và AI', reason: 'Hai xu hướng nổi bật', urls: ['https://vnexpress.net/chip-1', 'https://ngoai.test/x'] }] },
        usage: { inputTokens: 10, outputTokens: 5, thoughtTokens: 0 },
        text: '',
        raw: null,
      })),
    } as unknown as GeminiClient;
    const ai = await suggestTopics({ db, gemini, model: 'm' }, 'VN');
    expect(ai.source).toBe('ai');
    expect(ai.topics[0]!.urls).toEqual(['https://vnexpress.net/chip-1']);
  });

  it('không có tin trong kho: đề xuất trống', async () => {
    const r = await suggestTopics({ db, model: 'm' }, 'JP');
    expect(r.source).toBe('trống');
    expect(r.topics).toEqual([]);
  });
});
