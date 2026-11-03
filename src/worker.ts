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
import { fetchFeeds, generateTopic } from './services/generate.ts';
import { handleUpdate, parseAllowlist, type BotDeps } from './services/telegramBot.ts';
import { pollTelegram } from './jobs/telegramPoll.ts';
import { cleanupMedia } from './services/media.ts';

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

// Dọn media của bài đã đăng sau MEDIA_RETENTION_DAYS (FR-ADM-02), chạy lúc khởi động rồi mỗi 6 giờ.
const retentionDays = Number(process.env.MEDIA_RETENTION_DAYS ?? 7);
const mediaDir = process.env.MEDIA_DIR ?? './media';
const runCleanup = () =>
  cleanupMedia(pool, mediaDir, retentionDays)
    .then((r) => {
      if (r.deleted || r.skipped) console.log(JSON.stringify({ level: 'info', msg: 'media cleanup', ...r }));
    })
    .catch((e: Error) => console.error(JSON.stringify({ level: 'error', msg: 'media cleanup failed', error: e.message.slice(0, 300) })));
const cleanTimer = setInterval(() => void runCleanup(), 6 * 3_600_000);
setTimeout(() => void runCleanup(), 60_000);
void tick();
console.log(JSON.stringify({ level: 'info', msg: 'worker started', everyMinutes: everyMs / 60_000, publisher: !!deps.publisher, generator: !!deps.generator }));

// Bot Telegram: menu và lệnh cho người được cấp quyền (long polling, không cần HTTPS công khai).
let stopping = false;
const tgToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
if (tgToken) {
  const gen = deps.generator;
  const bot: BotDeps = {
    db: pool,
    token: tgToken,
    allowed: parseAllowlist(process.env.TELEGRAM_ALLOWED_USER_IDS),
    appUrl: process.env.APP_BASE_URL ?? '',
    createTopic: gen
      ? async (market, topic) => {
          const r = await generateTopic({ db: pool, ...gen }, { market, topic, model: gen.model });
          if (r.outcome === 'created') return `✅ Đã tạo bài #${r.id} (${market}), đang chờ duyệt.${process.env.APP_BASE_URL ? `\n${process.env.APP_BASE_URL}/contents/${r.id}` : ''}`;
          return `⚠️ ${r.detail}`;
        }
      : null,
  };
  void pollTelegram({ db: pool, token: tgToken, handle: (u) => handleUpdate(bot, u), isStopped: () => stopping });
}

const stop = async () => {
  stopping = true;
  clearInterval(timer);
  clearInterval(cleanTimer);
  await boss.stop({ graceful: true });
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
