import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers/freshDb.ts';
import type { Actor } from '../src/auth.ts';
import { packageHash, type ContentPackage } from '../src/domain/package.ts';
import type { FeedItem } from '../src/domain/rss.ts';
import type { GeminiClient } from '../src/providers/gemini.ts';
import { generateNews } from '../src/services/generate.ts';
import * as svc from '../src/services/contents.ts';
import { getStats } from '../src/services/stats.ts';
import { recordUsage } from '../src/services/costs.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql', '007_source_items.sql', '008_perf_indexes.sql'];
const MEDIA = path.join(os.tmpdir(), 'pp-test-media-big');
const schema = JSON.parse(readFileSync(new URL('../schemas/content_package.schema.json', import.meta.url), 'utf8')).schema as object;
const vn: Actor = { email: 'vn@t', name: 'VN', roles: ['approver_vn'] };

const pkgFor = (url: string): ContentPackage => ({
  market: 'VN', topic_summary: 't',
  post: { headline: `Tin ${url.slice(-3)}`, body: 'Nội dung tiếng Việt để kiểm thử sinh bản tin song song.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#DX'] },
  sources: [{ title: 'N', url }], claims_to_verify: [], media: { engine: 'NONE' },
});

d('tạo bản tin song song và thống kê AI (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => { const f = await freshDb(URL_!, MIGRATIONS); db = f.db; drop = f.drop; });
  afterAll(async () => { await drop?.(); });

  // Gemini giả: đọc URL từ prompt rồi trả bài đúng URL đó; đo số lượt chạy đồng thời.
  function fakeGemini(opts: { delayMs?: number; failUrl?: string } = {}) {
    let live = 0;
    let peak = 0;
    const g = {
      peak: () => peak,
      generateJson: vi.fn(async (req: { user: string }) => {
        const url = /URL: (\S+)/.exec(req.user)![1]!;
        live++;
        peak = Math.max(peak, live);
        await new Promise((r) => setTimeout(r, opts.delayMs ?? 20));
        live--;
        if (url === opts.failUrl) return { json: pkgFor('https://evil.test/zz'), usage: { inputTokens: 1, outputTokens: 1, thoughtTokens: 0 } };
        return { json: pkgFor(url), usage: { inputTokens: 100, outputTokens: 50, thoughtTokens: 0 } };
      }),
    };
    return g as typeof g & GeminiClient;
  }
  const items = (n: number, base: string): FeedItem[] => Array.from({ length: n }, (_, i) => ({ title: `Tin ${i}`, url: `https://x.test/${base}${i}`, summary: 's' }));

  it('chạy song song đúng số làn, chỉ tạo đủ số bài yêu cầu và báo tiến độ từng bước', async () => {
    const g = fakeGemini({ delayMs: 40 });
    const progress: number[] = [];
    const out = await generateNews({ db, gemini: g, schema, mediaDir: MEDIA, fetchItems: async () => items(6, 'p') }, { market: 'VN', limit: 3, model: 'm', concurrency: 3, onProgress: (_r, made) => progress.push(made) });
    expect(out.filter((r) => r.outcome === 'created')).toHaveLength(3);
    expect(g.generateJson).toHaveBeenCalledTimes(3);
    expect(g.peak()).toBe(3);
    expect(progress).toHaveLength(3);
    expect(Math.max(...progress)).toBe(3);
  });

  it('một mục hỏng được thay bằng mục kế tiếp để vẫn đủ số bài', async () => {
    const list = items(5, 'q');
    const g = fakeGemini({ failUrl: list[0]!.url });
    const out = await generateNews({ db, gemini: g, schema, mediaDir: MEDIA, fetchItems: async () => list }, { market: 'VN', limit: 2, model: 'm', concurrency: 2 });
    expect(out.filter((r) => r.outcome === 'created')).toHaveLength(2);
    expect(out.filter((r) => r.outcome === 'skipped')).toHaveLength(1);
  });

  it('concurrency 1 vẫn chạy tuần tự đúng như trước', async () => {
    const g = fakeGemini();
    await generateNews({ db, gemini: g, schema, mediaDir: MEDIA, fetchItems: async () => items(4, 'r') }, { market: 'VN', limit: 2, model: 'm', concurrency: 1 });
    expect(g.peak()).toBe(1);
  });

  it('thống kê hiệu quả AI: bài tạo, duyệt, chi phí mỗi bài duyệt, thời gian duyệt', async () => {
    const a = pkgFor('https://stat.test/s1');
    const b = pkgFor('https://stat.test/s2');
    const base = (await getStats(db, vn)).ai;
    const ida = await svc.createGenerated(db, a, 't');
    await svc.createGenerated(db, b, 't');
    await svc.approve(db, vn, ida, { revision: 1, packageHash: packageHash(a), scheduledAt: new Date(Date.now() + 3 * 3_600_000), claimsConfirmed: true });
    await recordUsage(db, { market: 'VN', purpose: 'NEWS', model: 'm', usage: { inputTokens: 1, outputTokens: 1, thoughtTokens: 0 }, costUsd: 0.5 });
    const s = (await getStats(db, vn)).ai;
    expect(s.created - base.created).toBe(2);
    expect(s.approved - base.approved).toBe(1);
    expect(s.spendUsd - base.spendUsd).toBeCloseTo(0.5, 5);
    expect(s.costPerApprovedUsd).not.toBeNull();
    expect(s.avgHoursToApprove).not.toBeNull();
    expect(s.passRate).not.toBeNull();
  });
});
