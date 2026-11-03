import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';
import { AiUnavailableError, classifyAiError, modelChainFromEnv, withFallback } from '../src/providers/aiChain.ts';
import type { GeminiClient } from '../src/providers/gemini.ts';
import { suggestTopics } from '../src/services/topics.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql', '007_source_items.sql'];

const ok = (model: string) => ({ model, text: '{}', json: { topics: [] }, usage: { inputTokens: 1, outputTokens: 1, thoughtTokens: 0 }, raw: null });
const err = (msg: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(msg), extra);

describe('phân loại lỗi AI', () => {
  it('nhận diện hết hạn mức, quá tải, quá chậm', () => {
    expect(classifyAiError(err('HTTP 429 /interactions: Rate limit exceeded', { status: 429 }))).toBe('hết hạn mức trong ngày');
    expect(classifyAiError(err('HTTP 503 /interactions: high demand', { status: 503 }))).toBe('đang quá tải');
    expect(classifyAiError(err('The operation was aborted', { name: 'TimeoutError' }))).toBe('phản hồi quá chậm');
    expect(classifyAiError(err('lỗi lạ'))).toBe('lỗi');
  });
});

describe('chuỗi mô hình dự phòng', () => {
  it('bỏ qua mô hình hết hạn mức, dùng mô hình kế tiếp và ghi đúng tên mô hình đã trả lời', async () => {
    const seen: string[] = [];
    const inner = {
      generateJson: async (a: { model: string }) => {
        seen.push(a.model);
        if (a.model === 'm1') throw err('HTTP 429 quota', { status: 429 });
        return ok(a.model);
      },
      tts: async () => ({ wav: Buffer.alloc(0), usage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0 } }),
    } as unknown as GeminiClient;
    const r = await withFallback(inner, ['m1', 'm2']).generateJson({ model: 'bỏ-qua', system: '', user: '', schema: {} });
    expect(seen).toEqual(['m1', 'm2']);
    expect(r.model).toBe('m2');
  });

  it('tất cả mô hình lỗi: ném AiUnavailableError kèm lý do từng mô hình', async () => {
    const inner = {
      generateJson: async () => {
        throw err('HTTP 503 busy', { status: 503 });
      },
      tts: async () => ({ wav: Buffer.alloc(0), usage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0 } }),
    } as unknown as GeminiClient;
    const p = withFallback(inner, ['a', 'b']).generateJson({ model: 'x', system: '', user: '', schema: {} });
    await expect(p).rejects.toBeInstanceOf(AiUnavailableError);
    await expect(p).rejects.toThrow('a: đang quá tải');
  });

  it('chuỗi cấu hình: bỏ khoảng trắng, bỏ trùng, mặc định 3.6 rồi 3.5', () => {
    expect(modelChainFromEnv({ GEMINI_MODELS: ' a , b,a ' } as NodeJS.ProcessEnv)).toEqual(['a', 'b', 'a']);
    expect(modelChainFromEnv({} as NodeJS.ProcessEnv)).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash']);
  });
});

d('đề xuất chủ đề khi AI lỗi (PostgreSQL thật)', () => {
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
    await db.query('DELETE FROM source_item');
    await db.query("INSERT INTO source_item(market, feed, url, title, summary, published_at) VALUES ('VN','vnexpress.net','https://vnexpress.net/a1','Tin mới một','tóm tắt',now())");
  });

  it('AI hết hạn mức: vẫn trả danh sách tin mới và ghi lý do, không ném lỗi', async () => {
    const gemini = {
      generateJson: async () => {
        throw err('HTTP 429 quota', { status: 429 });
      },
      tts: async () => ({ wav: Buffer.alloc(0), usage: { inputTokens: 0, outputTokens: 0, thoughtTokens: 0 } }),
    } as unknown as GeminiClient;
    const r = await suggestTopics({ db, gemini, model: 'm' }, 'VN');
    expect(r.source).toBe('tin-mới');
    expect(r.topics.length).toBe(1);
    expect(r.aiNote).toContain('AI tạm không dùng được');
  });
});
