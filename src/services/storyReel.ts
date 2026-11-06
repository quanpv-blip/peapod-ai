// Ghép phụ thuộc cho video v3 (storyboard): gọi AI có lược đồ, ghi chi phí, tìm văn bản nguồn đã lưu.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import type { ContentPackage, Market } from '../domain/package.ts';
import type { GeminiClient } from '../providers/gemini.ts';
import { getAppSettings } from './appSettings.ts';
import { capCheck, estimateCost, recordUsage } from './costs.ts';
import type { StorySource } from './reels.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
let cachedSchema: object | null = null;

/** Lược đồ storyboard (sinh từ peapod-video bằng `npm run manifest`, chép sang schemas/ của peapod-ai). */
export function storyboardSchema(): object {
  cachedSchema ??= JSON.parse(readFileSync(path.resolve(here, '..', '..', 'schemas', 'storyboard.schema.json'), 'utf8')) as object;
  return cachedSchema;
}

/** Hàm gọi AI cho đạo diễn: kiểm trần chi phí, gọi Gemini với lược đồ storyboard, ghi chi phí. */
export function makeDirector(db: pg.Pool, gemini: GeminiClient, model: string, market: Market) {
  return async (system: string, user: string): Promise<unknown> => {
    const s = await getAppSettings(db);
    const cap = await capCheck(db, s);
    if (!cap.allowed) throw new Error(cap.reason ?? 'Đã chạm trần chi phí AI');
    const gen = await gemini.generateJson({ model, system, user, schema: storyboardSchema() });
    const costUsd = estimateCost({ inputTokens: gen.usage.inputTokens, outputTokens: gen.usage.outputTokens, thoughtTokens: gen.usage.thoughtTokens }, s);
    await recordUsage(db, { market, purpose: 'NEWS', model: gen.model ?? model, usage: gen.usage, costUsd });
    return gen.json;
  };
}

/**
 * Tên báo để hiện trên thẻ nguồn. Gói nội dung thường lưu sources[0].title là tên báo ("VnExpress"); nếu nó dài như
 * một tiêu đề bài thì dùng tên miền (bỏ www.).
 */
export function outletName(pkg: ContentPackage): string {
  const t = pkg.sources[0]?.title?.trim() ?? '';
  if (t && [...t].length <= 30) return t;
  try {
    return new URL(pkg.sources[0]!.url).hostname.replace(/^www\./, '');
  } catch {
    return t.slice(0, 30);
  }
}

const ICT = (d: Date) => new Date(d.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);

/** Văn bản nguồn của bài: tóm tắt RSS đã lưu theo URL nguồn. Không có thì trả rỗng (đạo diễn dùng bài đã duyệt). */
export async function storySource(db: pg.Pool, pkg: ContentPackage): Promise<StorySource> {
  const urls = pkg.sources.map((s) => s.url);
  const r = await db.query<{ title: string; summary: string; published_at: Date | null }>(
    'SELECT title, summary, published_at FROM source_item WHERE url = ANY($1) ORDER BY published_at DESC NULLS LAST LIMIT 3',
    [urls],
  );
  const text = r.rows.map((x) => `${x.title}\n${x.summary}`).join('\n\n').trim();
  let outlet = '';
  try {
    outlet = new URL(pkg.sources[0]!.url).hostname.replace(/^www\./, '');
  } catch {
    /* URL đã được kiểm khi tạo bài */
  }
  const at = r.rows[0]?.published_at;
  return { text, outlet, ...(at ? { publishedAt: ICT(at) } : {}) };
}
