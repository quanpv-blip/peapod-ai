// Cơ sở dữ liệu tạm riêng cho mỗi bộ test tích hợp: tạo, áp migration, trả về pool; xóa khi xong.
// Dùng DB riêng (không dùng schema) để tránh xung đột tên với bảng thật trên cùng cơ sở dữ liệu.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';

export async function freshDb(baseUrl: string, migrations: string[]): Promise<{ db: pg.Pool; drop: () => Promise<void> }> {
  const name = `pp_t_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: baseUrl, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(baseUrl);
  u.pathname = `/${name}`;
  const db = new pg.Pool({ connectionString: u.toString(), max: 4 });
  // Client nhàn rỗi có thể bị máy chủ ngắt khi DROP ... FORCE chạy ở cuối bộ test; không có listener thì thành lỗi không bắt được.
  db.on('error', () => {});
  admin.on('error', () => {});
  for (const f of migrations) {
    await db.query(readFileSync(new URL(`../../db/migrations/${f}`, import.meta.url), 'utf8'));
  }
  return {
    db,
    drop: async () => {
      await db.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}
