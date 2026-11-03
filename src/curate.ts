// Sinh bản tin ngành có nguồn từ RSS vào hàng chờ duyệt bằng Gemini (GN-02/GN-03, bản demo).
// Chạy: npx tsx src/curate.ts --market JP --limit 3 [--dry-run]
// Chỉ dùng dữ liệu công khai. Gói Free của Google dùng nội dung để cải thiện sản phẩm (docs/09).
import { existsSync, readFileSync } from 'node:fs';
import { requireEnv } from './config.ts';
import { createPool } from './db.ts';
import { languageMatchesMarket, unknownSources, validatePackage, type Market } from './domain/package.ts';
import { NEWS_RULES, NEWS_VOICE, newsUserPrompt, unusedItems } from './domain/editorial.ts';
import { dedupeByUrl, parseFeed, type FeedItem } from './domain/rss.ts';
import { sanitize } from './domain/sanitizer.ts';
import { createGeminiClient } from './providers/gemini.ts';
import { createGenerated } from './services/contents.ts';

if (existsSync('.env')) process.loadEnvFile('.env'); // không ghi đè biến đã có trong môi trường

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const market = opt('market', 'JP').toUpperCase() as Market;
const limit = Math.max(1, Number(opt('limit', '3')));
const model = opt('model', 'gemini-3.6-flash');
const dryRun = args.includes('--dry-run');

const FEEDS: Record<Market, string[]> = {
  JP: ['https://xtech.nikkei.com/rss/index.rdf', 'https://rss.itmedia.co.jp/rss/2.0/itmedia_all.xml'],
  VN: ['https://vnexpress.net/rss/so-hoa.rss'],
};

async function fetchFeeds(): Promise<FeedItem[]> {
  const all: FeedItem[] = [];
  for (const u of FEEDS[market]) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 peapod-curate' }, signal: AbortSignal.timeout(20_000) });
      all.push(...parseFeed(await r.text(), 15));
    } catch (e) {
      console.warn(`cảnh báo: nguồn lỗi ${u} (${(e as Error).name})`); // một nguồn lỗi không làm hỏng cả lượt
    }
  }
  return dedupeByUrl(all);
}

async function main() {
  const pool = createPool(requireEnv('DATABASE_URL'));
  try {
    const used = new Set(
      (await pool.query<{ url: string }>(`SELECT DISTINCT jsonb_array_elements(package->'sources')->>'url' AS url FROM content_revision`)).rows.map((r) => r.url),
    );
    const candidates = unusedItems(await fetchFeeds(), used);
    console.log(`${market}: ${candidates.length} mục mới chưa dùng, mục tiêu ${limit} bài, mô hình ${model}${dryRun ? ' (dry-run)' : ''}`);

    const schema = JSON.parse(readFileSync('schemas/content_package.schema.json', 'utf8')).schema as object;
    const gemini = createGeminiClient();
    let made = 0;

    for (const item of candidates) {
      if (made >= limit) break;
      const s = sanitize(`${item.title} — ${item.summary}`);
      try {
        const gen = await gemini.generateJson({
          model,
          system: `${NEWS_RULES}\n\n${NEWS_VOICE[market]}`,
          user: newsUserPrompt(market, `1. ${s.text}\n   URL: ${item.url}`),
          schema,
        });
        const v = validatePackage(gen.json);
        if (!v.ok) { console.log(`  bỏ qua (schema): ${item.title.slice(0, 50)} — ${v.errors[0]}`); continue; }
        const pkg = v.value;
        if (pkg.market !== market) { console.log(`  bỏ qua (sai thị trường): ${item.title.slice(0, 50)}`); continue; }
        if (unknownSources(pkg, [item.url]).length) { console.log(`  bỏ qua (nguồn lạ): ${item.title.slice(0, 50)}`); continue; }
        if (!languageMatchesMarket(pkg.post.body, market)) { console.log(`  bỏ qua (sai ngôn ngữ): ${item.title.slice(0, 50)}`); continue; }

        if (dryRun) {
          console.log(`\n[${made + 1}] ${pkg.post.headline}\n${pkg.post.body}\nCTA: ${pkg.post.call_to_action}\n${pkg.post.hashtags.join(' ')}\nNguồn: ${pkg.sources.map((x) => x.url).join(', ')}\nCần kiểm: ${pkg.claims_to_verify.join(' | ') || '(không)'}`);
        } else {
          const id = await createGenerated(pool, pkg, model);
          console.log(`+ bài #${id}: ${pkg.post.headline}`);
        }
        made++;
      } catch (e) {
        console.log(`  lỗi: ${item.title.slice(0, 50)} — ${(e as Error).message.slice(0, 160)}`);
      }
    }
    console.log(`\nXong: ${made} bài ${dryRun ? '(chưa ghi DB)' : 'vào hàng chờ duyệt'}`);
  } finally {
    await pool.end();
  }
}

await main();
