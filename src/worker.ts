import { readFileSync } from 'node:fs';
import { PgBoss } from 'pg-boss';
import { loadBaseConfig } from './config.ts';
import { createPool } from './db.ts';
import { runCycle, type CycleDeps } from './jobs/cycle.ts';
import { notifyAll } from './services/alerts.ts';
import { createGeminiClient } from './providers/gemini.ts';
import { modelChainFromEnv, withFallback } from './providers/aiChain.ts';
import { markAiExhausted } from './services/quota.ts';
import { createMetaClient } from './providers/meta.ts';
import { pagesFromEnv } from './services/publish.ts';
import { fetchFeeds } from './services/generate.ts';

// Worker: hàng đợi pg-boss (ADR-03) giữ lại cho các job sau này; chu kỳ nền chạy theo nhịp, có khóa tư vấn để một lúc chỉ một tiến trình chạy.
const cfg = loadBaseConfig();
const boss = new PgBoss(cfg.DATABASE_URL);
boss.on('error', (e) => console.error('pg-boss lỗi:', e.message));

await boss.start();
await boss.createQueue('system.ping');
await boss.work('system.ping', async (jobs) => {
  for (const j of jobs) console.log(JSON.stringify({ level: 'info', msg: 'ping', id: j.id }));
});

const pool = createPool(cfg.DATABASE_URL);
const pages = pagesFromEnv(process.env);
const schema = JSON.parse(readFileSync(new URL('../schemas/content_package.schema.json', import.meta.url), 'utf8')).schema as object;
const deps: CycleDeps = {
  db: pool,
  publisher: Object.keys(pages).length
    ? { db: pool, meta: createMetaClient(), pages, bucPausePct: Number(process.env.META_BUC_PAUSE_THRESHOLD ?? 80), bucPauseMinutes: Number(process.env.META_BUC_PAUSE_MINUTES ?? 30) }
    : undefined,
  generator: process.env.GEMINI_API_KEY
    ? {
        gemini: withFallback(createGeminiClient(), modelChainFromEnv(), {
          // Chỉ báo một lần mỗi ngày cho mỗi mô hình (markAiExhausted trả về true ở lần đầu trong ngày).
          onExhausted: async (m) => {
            if (await markAiExhausted(pool, m)) await notifyAll(`⚠️ Mô hình ${m} đã hết hạn mức hôm nay. Hệ thống chuyển sang mô hình dự phòng nếu còn.`);
          },
        }),
        schema,
        mediaDir: process.env.MEDIA_DIR ?? './media',
        model: modelChainFromEnv()[0] ?? 'gemini-3.5-flash',
      }
    : undefined,
  notify: (text) => notifyAll(text),
  fetchFeeds: (feeds) => fetchFeeds(feeds),
};

const CYCLE_LOCK = 7101;
const everyMs = Number(process.env.CYCLE_MINUTES ?? 5) * 60_000;
let busy = false;

async function tick(): Promise<void> {
  if (busy) return;
  busy = true;
  const lock = await pool.connect();
  try {
    const got = await lock.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [CYCLE_LOCK]);
    if (!got.rows[0]?.ok) return; // tiến trình khác đang chạy chu kỳ
    try {
      for (const line of await runCycle(deps)) console.log(JSON.stringify({ level: 'info', msg: 'cycle', detail: line }));
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [CYCLE_LOCK]);
    }
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'cycle failed', error: (e as Error).message.slice(0, 300) }));
  } finally {
    lock.release();
    busy = false;
  }
}

const timer = setInterval(() => void tick(), everyMs);
void tick();
console.log(JSON.stringify({ level: 'info', msg: 'worker started', everyMinutes: everyMs / 60_000, publisher: !!deps.publisher, generator: !!deps.generator }));

const stop = async () => {
  clearInterval(timer);
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
