import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { ContentPackage } from '../src/domain/package.ts';
import { createGenerated } from '../src/services/contents.ts';
import { cleanupMedia } from '../src/services/media.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql'];

const pkg = (n: number): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline: `Tin media ${n}`, body: 'Nội dung tiếng Việt trung lập về sự kiện công nghệ hôm nay.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#CN'] },
  sources: [{ title: 'VnExpress', url: `https://vnexpress.net/m${n}` }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});

d('dọn media đã đăng (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
  let root: string;
  let mediaDir: string;

  beforeAll(async () => {
    const f = await freshDb(URL_!, MIGRATIONS);
    db = f.db;
    drop = f.drop;
    root = mkdtempSync(join(tmpdir(), 'pp-media-'));
    mediaDir = join(root, 'media');
    mkdirSync(mediaDir);
  });
  afterAll(async () => {
    await drop?.();
    rmSync(root, { recursive: true, force: true });
  });

  // Tạo một bài có một file ảnh; trạng thái và thời điểm cập nhật do từng ca quyết định.
  async function asset(n: number, state: string, updatedDaysAgo: number, file: string): Promise<number> {
    const id = await createGenerated(db, pkg(n), 'test');
    await db.query("UPDATE content_item SET state = $2, updated_at = now() - make_interval(days => $3) WHERE id = $1", [id, state, updatedDaysAgo]);
    writeFileSync(file, 'png');
    await db.query("INSERT INTO media_asset(content_id, revision, kind, path) VALUES ($1, 1, 'IMAGE', $2)", [id, file]);
    return id;
  }

  it('xóa file của bài đã đăng quá hạn; giữ bài đăng gần đây và bài chưa đăng', async () => {
    const old = join(mediaDir, 'old.png');
    const recent = join(mediaDir, 'recent.png');
    const pending = join(mediaDir, 'pending.png');
    await asset(1, 'PUBLISHED', 10, old);
    await asset(2, 'PUBLISHED', 1, recent);
    await asset(3, 'IN_REVIEW', 30, pending);

    const r = await cleanupMedia(db, mediaDir, 7);
    expect(r.deleted).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(pending)).toBe(true);
  });

  it('không xóa file nằm ngoài thư mục media, dù bản ghi trỏ tới', async () => {
    const outside = join(root, 'outside.png');
    await asset(4, 'PUBLISHED', 10, outside);
    const r = await cleanupMedia(db, mediaDir, 7);
    expect(r.skipped).toBe(1);
    expect(existsSync(outside)).toBe(true);
  });

  it('chạy lặp lại không lỗi; file đã mất không làm hỏng lần chạy', async () => {
    const r1 = await cleanupMedia(db, mediaDir, 7);
    const r2 = await cleanupMedia(db, mediaDir, 7);
    expect(r1.skipped).toBe(1);
    expect(r2.deleted).toBe(0);
  });
});
