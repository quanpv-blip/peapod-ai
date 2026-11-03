import pg from 'pg';

// BIGINT (OID 20) mặc định về chuỗi để tránh mất độ chính xác. Id nội dung ở đây luôn nhỏ hơn 2^53,
// nên ép về number để khóa Map/so sánh dùng được (R-06). Đây là cài đặt toàn cục của thư viện pg.
pg.types.setTypeParser(20, (v) => Number(v));

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

export async function ping(pool: pg.Pool): Promise<boolean> {
  const r = await pool.query('SELECT 1 AS ok');
  return r.rows[0]?.ok === 1;
}
