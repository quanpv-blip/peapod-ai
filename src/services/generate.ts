// Sinh bản tin ngành có nguồn từ RSS vào hàng chờ (GN-02/GN-03, bản demo bằng Gemini). Dùng chung cho CLI và giao diện.
import type pg from 'pg';
import { languageMatchesMarket, unknownSources, validatePackage, type ContentPackage, type Market } from '../domain/package.ts';
import { NEWS_RULES, NEWS_VOICE, newsUserPrompt, unusedItems } from '../domain/editorial.ts';
import { dedupeByUrl, parseFeed, type FeedItem } from '../domain/rss.ts';
import { sanitize } from '../domain/sanitizer.ts';
import type { GeminiClient } from '../providers/gemini.ts';
import { createGenerated } from './contents.ts';
import { isPaused } from './settings.ts';

export const FEEDS: Record<Market, string[]> = {
  JP: ['https://xtech.nikkei.com/rss/index.rdf', 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml'],
  VN: ['https://vnexpress.net/rss/so-hoa.rss'],
};

/** Đọc RSS của thị trường; một nguồn lỗi không làm hỏng cả lượt (FR-RES-03). */
export async function fetchFeeds(market: Market): Promise<FeedItem[]> {
  const all: FeedItem[] = [];
  for (const u of FEEDS[market]) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 peapod-curate' }, signal: AbortSignal.timeout(20_000) });
      all.push(...parseFeed(await r.text(), 15));
    } catch (e) {
      console.warn(`cảnh báo: nguồn lỗi ${u} (${(e as Error).name})`);
    }
  }
  return dedupeByUrl(all);
}

export interface GenerateDeps {
  db: pg.Pool;
  gemini: GeminiClient;
  schema: object;
  fetchItems: (m: Market) => Promise<FeedItem[]>;
}

export interface GenerateOptions {
  market: Market;
  limit: number;
  model: string;
  dryRun?: boolean;
}

export interface GenerateResult {
  title: string;
  outcome: 'created' | 'dry-run' | 'skipped' | 'error';
  detail: string;
  id?: number;
  pkg?: ContentPackage;
}

/** Sinh tối đa `limit` bài từ các mục RSS chưa dùng. Mỗi mục là một lần gọi riêng để không lẫn nguồn. */
export async function generateNews(deps: GenerateDeps, opts: GenerateOptions): Promise<GenerateResult[]> {
  if (await isPaused(deps.db)) return [{ title: '', outcome: 'skipped', detail: 'Công tắc tạm dừng đang bật' }];

  const used = new Set((await deps.db.query<{ url: string }>(`SELECT DISTINCT jsonb_array_elements(package->'sources')->>'url' AS url FROM content_revision`)).rows.map((r) => r.url));
  const candidates = unusedItems(await deps.fetchItems(opts.market), used);
  const out: GenerateResult[] = [];
  let made = 0;

  for (const item of candidates) {
    if (made >= opts.limit) break;
    const s = sanitize(`${item.title} — ${item.summary}`);
    const title = item.title.slice(0, 60);
    try {
      const gen = await deps.gemini.generateJson({
        model: opts.model,
        system: `${NEWS_RULES}\n\n${NEWS_VOICE[opts.market]}`,
        user: newsUserPrompt(opts.market, `1. ${s.text}\n   URL: ${item.url}`),
        schema: deps.schema,
      });
      const v = validatePackage(gen.json);
      if (!v.ok) { out.push({ title, outcome: 'skipped', detail: `schema: ${v.errors[0]}` }); continue; }
      const pkg = v.value;
      if (pkg.market !== opts.market) { out.push({ title, outcome: 'skipped', detail: 'sai thị trường' }); continue; }
      if (unknownSources(pkg, [item.url]).length) { out.push({ title, outcome: 'skipped', detail: 'nguồn không nằm trong RSS' }); continue; }
      if (!languageMatchesMarket(pkg.post.body, opts.market)) { out.push({ title, outcome: 'skipped', detail: 'sai ngôn ngữ' }); continue; }

      made++;
      if (opts.dryRun) {
        out.push({ title: pkg.post.headline, outcome: 'dry-run', detail: 'chưa ghi', pkg });
      } else {
        const id = await createGenerated(deps.db, pkg, opts.model);
        out.push({ title: pkg.post.headline, outcome: 'created', detail: `bài #${id}`, id, pkg });
      }
    } catch (e) {
      out.push({ title, outcome: 'error', detail: (e as Error).message.slice(0, 160) });
    }
  }
  return out;
}
