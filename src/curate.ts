// Sinh bản tin ngành có nguồn từ RSS vào hàng chờ duyệt (CLI). Logic nằm ở services/generate.ts.
// Chạy: npx tsx src/curate.ts --market JP --limit 3 [--dry-run]
// Chỉ dùng dữ liệu công khai. Gói Free của Google dùng nội dung để cải thiện sản phẩm (docs/09).
import { existsSync, readFileSync } from 'node:fs';
import { requireEnv } from './config.ts';
import { createPool } from './db.ts';
import type { Market } from './domain/package.ts';
import { createGeminiClient } from './providers/gemini.ts';
import { fetchFeeds, generateNews } from './services/generate.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const args = process.argv.slice(2);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const market = opt('market', 'JP').toUpperCase() as Market;
const limit = Math.max(1, Number(opt('limit', '3')));
const model = opt('model', 'gemini-3.6-flash');
const dryRun = args.includes('--dry-run');

const pool = createPool(requireEnv('DATABASE_URL'));
try {
  const schema = JSON.parse(readFileSync('schemas/content_package.schema.json', 'utf8')).schema as object;
  console.log(`${market}: mục tiêu ${limit} bài, mô hình ${model}${dryRun ? ' (dry-run)' : ''}`);
  const results = await generateNews({ db: pool, gemini: createGeminiClient(), schema, fetchItems: fetchFeeds }, { market, limit, model, dryRun });
  for (const r of results) {
    if (r.outcome === 'created') console.log(`+ ${r.detail}: ${r.title}`);
    else if (r.outcome === 'dry-run' && r.pkg) console.log(`\n[dry-run] ${r.pkg.post.headline}\n${r.pkg.post.body}\nNguồn: ${r.pkg.sources.map((s) => s.url).join(', ')}`);
    else console.log(`  ${r.outcome}: ${r.title} — ${r.detail}`);
  }
  console.log(`\nXong: ${results.filter((r) => r.outcome === 'created' || r.outcome === 'dry-run').length} bài`);
} finally {
  await pool.end();
}
