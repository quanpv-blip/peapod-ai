import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import { loadBaseConfig, requireEnv } from './config.ts';
import { createPool, ping } from './db.ts';
import { readFileSync } from 'node:fs';
import { createGeminiClient } from './providers/gemini.ts';
import { modelChainFromEnv, withFallback } from './providers/aiChain.ts';
import { createMetaClient } from './providers/meta.ts';
import { pagesFromEnv } from './services/publish.ts';
import { registerWeb } from './web/routes.ts';

const cfg = loadBaseConfig();
const pool = createPool(cfg.DATABASE_URL);

const app = Fastify({
  logger: {
    level: cfg.LOG_LEVEL,
    // Không bao giờ ghi header xác thực hoặc cookie vào log (NFR-OBS-01).
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
});

const sessionSecret = requireEnv('AUTH_SESSION_SECRET');
if (sessionSecret.length < 32) throw new Error('AUTH_SESSION_SECRET phải dài ít nhất 32 ký tự');

await app.register(fastifyCookie);
await app.register(fastifyFormbody);
// Đăng Meta chỉ bật khi có cấu hình Trang; không có thì giao diện vẫn chạy, chỉ không hủy được bài đã hẹn.
const pages = pagesFromEnv(process.env);
// Sinh bản tin bằng AI chỉ bật khi có khóa Gemini. Schema đọc từ cùng nguồn với bộ kiểm tra (schemas/).
const schema = JSON.parse(readFileSync(new URL('../schemas/content_package.schema.json', import.meta.url), 'utf8')).schema as object;
await registerWeb(app, {
  db: pool,
  sessionSecret,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  publisher: Object.keys(pages).length ? { db: pool, meta: createMetaClient(), pages } : undefined,
  generator: process.env.GEMINI_API_KEY ? { gemini: withFallback(createGeminiClient(), modelChainFromEnv()), schema, mediaDir: process.env.MEDIA_DIR ?? './media', model: modelChainFromEnv()[0] ?? 'gemini-3.5-flash' } : undefined,
});

// Công khai, không lộ chi tiết (xem docs/10 mục 3).
app.get('/healthz', async (_req, reply) => {
  try {
    await ping(pool);
    return { status: 'ok' };
  } catch {
    return reply.code(503).send({ status: 'unavailable' });
  }
});

const shutdown = async () => {
  await app.close();
  await pool.end();
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

app.listen({ port: cfg.PORT, host: '0.0.0.0' }).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
