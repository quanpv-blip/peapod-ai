// Dọn media đã đăng (FR-ADM-02): xóa file ảnh/video sau MEDIA_RETENTION_DAYS ngày kể từ khi bài chuyển sang PUBLISHED.
// Chỉ xóa file của bài đã đăng, và chỉ khi file nằm trong MEDIA_DIR. Bản ghi media_asset được giữ lại để truy vết.
import { unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type pg from 'pg';

export interface CleanupResult {
  scheduled: number;
  deleted: number;
  skipped: number;
}

export async function cleanupMedia(db: pg.Pool, mediaDir: string, retentionDays: number, now = new Date()): Promise<CleanupResult> {
  // Đặt hạn xóa cho media của bài đã đăng mà chưa có hạn. Mốc là lần cập nhật cuối (lúc chuyển sang PUBLISHED).
  const sched = await db.query(
    `UPDATE media_asset m SET delete_after = c.updated_at + make_interval(days => $1)
       FROM content_item c
      WHERE c.id = m.content_id AND c.state = 'PUBLISHED' AND m.delete_after IS NULL`,
    [retentionDays],
  );

  const due = await db.query<{ path: string }>('SELECT path FROM media_asset WHERE delete_after IS NOT NULL AND delete_after <= $1', [now]);
  const root = resolve(mediaDir) + sep;
  let deleted = 0;
  let skipped = 0;
  for (const row of due.rows) {
    const file = resolve(row.path);
    // Không xóa file ngoài thư mục media, kể cả khi dữ liệu bị sửa tay.
    if (!file.startsWith(root)) {
      skipped++;
      continue;
    }
    try {
      await unlink(file);
      deleted++;
    } catch (e) {
      // File đã xóa từ trước thì không tính gì; lỗi khác (quyền truy cập) được đếm là bỏ qua.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') skipped++;
    }
  }
  return { scheduled: sched.rowCount ?? 0, deleted, skipped };
}
