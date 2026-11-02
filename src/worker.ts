import { PgBoss } from 'pg-boss';
import { loadBaseConfig } from './config.ts';

// Khung worker (epic E0). Các job nghiệp vụ (research, generate, publish...) được thêm ở các epic sau.
// Hàng đợi nằm trong PostgreSQL (ADR-03), schema `pgboss` do pg-boss tự quản lý.
const cfg = loadBaseConfig();
const boss = new PgBoss(cfg.DATABASE_URL);
boss.on('error', (e) => console.error('pg-boss lỗi:', e.message));

await boss.start();
await boss.createQueue('system.ping');
await boss.work('system.ping', async (jobs) => {
  for (const j of jobs) console.log(JSON.stringify({ level: 'info', msg: 'ping', id: j.id }));
});
console.log(JSON.stringify({ level: 'info', msg: 'worker started' }));

const stop = async () => {
  await boss.stop({ graceful: true });
  process.exit(0);
};
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
