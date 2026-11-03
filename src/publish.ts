// Chạy một lượt đăng: hẹn giờ bài đã duyệt, rồi đối soát bài đã hẹn. Dùng tay hoặc cron; worker sẽ gọi cùng hàm này (P-02).
// Chạy: npx tsx src/publish.ts [--dry-run]    --dry-run: chỉ in bài sẽ hẹn, không gọi Meta, không ghi DB.
import { existsSync } from 'node:fs';
import { requireEnv } from './config.ts';
import { createPool } from './db.ts';
import { createMetaClient } from './providers/meta.ts';
import { pagesFromEnv, publishApproved, reconcileScheduled } from './services/publish.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const dryRun = process.argv.includes('--dry-run');
const pages = pagesFromEnv(process.env);
const markets = Object.keys(pages);
if (markets.length === 0) throw new Error('Chưa có cấu hình Trang (FB_VN_PAGE_ID/TOKEN hoặc FB_JP_PAGE_ID/TOKEN)');

const pool = createPool(requireEnv('DATABASE_URL'));
try {
  const deps = { db: pool, meta: createMetaClient(), pages };
  console.log(`Thị trường có Trang: ${markets.join(', ')}${dryRun ? ' (dry-run)' : ''}`);

  const published = await publishApproved(deps, { dryRun });
  for (const r of published) console.log(`  #${r.id} ${r.outcome}: ${r.detail}`);
  if (published.length === 0) console.log('  không có bài APPROVED');

  if (!dryRun) {
    const reconciled = await reconcileScheduled(deps);
    for (const r of reconciled) console.log(`  #${r.id} ${r.outcome}: ${r.detail}`);
    if (reconciled.length === 0) console.log('  không có bài đã hẹn cần đối soát');
  }
} finally {
  await pool.end();
}
