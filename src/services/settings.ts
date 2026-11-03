// Công tắc tạm dừng toàn cục (N-02): khi bật, không hẹn bài mới lên Meta và không sinh bài mới.
// Hủy bài và đối soát vẫn chạy: đó là các thao tác an toàn hơn, không làm phát sinh bài mới.
import type pg from 'pg';

const PAUSED = 'paused';

export async function isPaused(db: pg.Pool | pg.PoolClient): Promise<boolean> {
  const r = await db.query<{ value: string }>('SELECT value FROM app_config WHERE key = $1', [PAUSED]);
  return r.rows[0]?.value === 'true';
}

export async function setPaused(db: pg.Pool, paused: boolean, actor: string): Promise<void> {
  await db.query(
    `INSERT INTO app_config(key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [PAUSED, paused ? 'true' : 'false', actor],
  );
}
