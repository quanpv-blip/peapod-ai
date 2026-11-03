// Lưu và đọc cấu hình vận hành (bảng app_config, khóa 'settings'). Thiếu khóa thì dùng mặc định.
import type pg from 'pg';
import { DEFAULT_SETTINGS, parseSettings, type AppSettings, type SettingsCheck } from '../domain/appSettings.ts';

const KEY = 'settings';

export async function getAppSettings(db: pg.Pool | pg.PoolClient): Promise<AppSettings> {
  const r = await db.query<{ value: string }>('SELECT value FROM app_config WHERE key = $1', [KEY]);
  if (!r.rows[0]) return DEFAULT_SETTINGS;
  try {
    const saved = JSON.parse(r.rows[0].value) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...saved, feeds: { ...DEFAULT_SETTINGS.feeds, ...saved.feeds }, genTime: { ...DEFAULT_SETTINGS.genTime, ...saved.genTime }, defaultPostTime: { ...DEFAULT_SETTINGS.defaultPostTime, ...saved.defaultPostTime } };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Lưu cấu hình từ form. Trả về lỗi kiểm tra nếu không hợp lệ (không ghi gì). */
export async function saveAppSettings(db: pg.Pool, form: Record<string, unknown>, actor: string): Promise<SettingsCheck> {
  const checked = parseSettings(form);
  if (!checked.ok) return checked;
  await db.query(
    `INSERT INTO app_config(key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [KEY, JSON.stringify(checked.value), actor],
  );
  return checked;
}

/** Ghi/đọc một khóa đơn giản (dùng cho nhịp chạy và tạm dừng do BUC). */
export async function getFlag(db: pg.Pool | pg.PoolClient, key: string): Promise<string | undefined> {
  const r = await db.query<{ value: string }>('SELECT value FROM app_config WHERE key = $1', [key]);
  return r.rows[0]?.value;
}

export async function setFlag(db: pg.Pool | pg.PoolClient, key: string, value: string, actor = 'system'): Promise<void> {
  await db.query(
    `INSERT INTO app_config(key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [key, value, actor],
  );
}
