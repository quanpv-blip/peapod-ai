import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import { loadBaseConfig, requireEnv } from './config.ts';
import { createPool, ping } from './db.ts';
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
await registerWeb(app, { db: pool, sessionSecret, cookieSecure: process.env.COOKIE_SECURE === 'true' });

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
