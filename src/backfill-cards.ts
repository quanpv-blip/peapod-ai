// Dựng ảnh thẻ cho các bài REMOTION_CARD chưa có ảnh (bài tạo trước khi có tính năng ảnh thẻ). An toàn chạy lại nhiều lần.
// Chạy: npx tsx poc/backfill-cards.ts
import { existsSync } from 'node:fs';
import { createPool } from './db.ts';
import { requireEnv } from './config.ts';
import type { ContentPackage } from './domain/package.ts';
import { storeCard } from './services/generate.ts';

if (existsSync('.env')) process.loadEnvFile('.env');
const pool = createPool(requireEnv('DATABASE_URL'));
const mediaDir = process.env.MEDIA_DIR ?? './media';
try {
  const rows = await pool.query<{ id: number; revision: number; package: ContentPackage }>(
    `SELECT i.id, i.current_revision AS revision, r.package
       FROM content_item i JOIN content_revision r ON r.content_id = i.id AND r.revision = i.current_revision
      WHERE r.package->'media'->>'engine' = 'REMOTION_CARD'
        AND NOT EXISTS (SELECT 1 FROM media_asset m WHERE m.content_id = i.id AND m.revision = i.current_revision AND m.kind = 'IMAGE')
        AND i.state NOT IN ('PUBLISHED','CANCELLED','REJECTED')
      ORDER BY i.id`,
  );
  for (const r of rows.rows) {
    const file = await storeCard(pool, mediaDir, r.id, r.revision, r.package);
    console.log(`+ thẻ bài #${r.id} r${r.revision}: ${file}`);
  }
  console.log(`xong: ${rows.rows.length} bài`);
} finally {
  await pool.end();
}
