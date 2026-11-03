import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { markAiExhausted } from '../src/services/quota.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql'];

d('cảnh báo hết hạn mức AI (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const f = await freshDb(URL_!, MIGRATIONS);
    db = f.db;
    drop = f.drop;
  });
  afterAll(async () => {
    await drop?.();
  });

  it('lần đầu trong ngày trả về true, các lần sau cùng ngày trả về false', async () => {
    const now = new Date('2026-11-03T12:00:00Z');
    expect(await markAiExhausted(db, 'gemini-x', now)).toBe(true);
    expect(await markAiExhausted(db, 'gemini-x', new Date('2026-11-03T13:00:00Z'))).toBe(false);
  });

  it('sang chu kỳ hạn mức mới (sau nửa đêm Thái Bình Dương) thì báo lại', async () => {
    // Sau DST (1/11/2026) nửa đêm Thái Bình Dương là 08:00 UTC. Chu kỳ 03/11 và 05/11 là hai chu kỳ khác nhau.
    expect(await markAiExhausted(db, 'gemini-y', new Date('2026-11-03T12:00:00Z'))).toBe(true);
    expect(await markAiExhausted(db, 'gemini-y', new Date('2026-11-05T12:00:00Z'))).toBe(true);
  });

  it('mỗi mô hình đếm riêng', async () => {
    expect(await markAiExhausted(db, 'gemini-z1', new Date('2026-11-03T12:00:00Z'))).toBe(true);
    expect(await markAiExhausted(db, 'gemini-z2', new Date('2026-11-03T12:00:00Z'))).toBe(true);
  });
});
