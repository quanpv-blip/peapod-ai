import Fastify from 'fastify';
import { loadBaseConfig } from './config.ts';
import { createPool, ping } from './db.ts';

const cfg = loadBaseConfig();
const pool = createPool(cfg.DATABASE_URL);

const app = Fastify({
  logger: {
    level: cfg.LOG_LEVEL,
    // Không bao giờ ghi header xác thực hoặc cookie vào log (NFR-OBS-01).
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
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
