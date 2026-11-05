// Video Reels 9:16 cho một bài: dựng qua dịch vụ Remotion, lưu vào media_asset (kind VIDEO_FINAL), theo dõi trạng thái chạy nền.
// Trạng thái lưu trong app_config (khóa reel:<id>) nên không cần bảng mới.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { ContentPackage } from '../domain/package.ts';
import { cardInputFrom, type CardInput } from '../media/card.ts';
import { getFlag, setFlag } from './appSettings.ts';

export const REEL_W = 1080;
export const REEL_H = 1920;

export interface ReelStatus {
  state: 'pending' | 'ready' | 'error';
  at: string;
  error?: string;
}

const flagKey = (contentId: number) => `reel:${contentId}`;

export async function reelStatus(db: pg.Pool, contentId: number): Promise<ReelStatus | null> {
  const v = await getFlag(db, flagKey(contentId));
  return v ? (JSON.parse(v) as ReelStatus) : null;
}

async function setReelStatus(db: pg.Pool, contentId: number, s: ReelStatus): Promise<void> {
  await setFlag(db, flagKey(contentId), JSON.stringify(s), 'system:reel');
}

export interface ReelDeps {
  db: pg.Pool;
  mediaDir: string;
  renderReel: (input: CardInput) => Promise<Buffer | null>;
  now?: () => Date;
}

/** Dựng video cho revision và ghi vào media_asset. Ném lỗi nếu dịch vụ không trả về video. */
export async function generateReel(deps: ReelDeps, contentId: number, revision: number, pkg: ContentPackage): Promise<string> {
  const now = deps.now?.() ?? new Date();
  const date = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
  const mp4 = await deps.renderReel(cardInputFrom(pkg, date));
  if (!mp4) throw new Error('Dịch vụ Remotion không trả về video');
  const dir = path.join(deps.mediaDir, 'reels');
  await mkdir(dir, { recursive: true });
  // Tên có thêm mốc thời gian để dựng lại không ghi đè video cũ (giữ lịch sử).
  const file = path.join(dir, `${contentId}-r${revision}-${now.getTime()}.mp4`);
  await writeFile(file, mp4);
  const sha = createHash('sha256').update(mp4).digest('hex');
  await deps.db.query(
    "INSERT INTO media_asset(content_id, revision, kind, path, sha256, width, height) VALUES ($1,$2,'VIDEO_FINAL',$3,$4,$5,$6)",
    [contentId, revision, file, sha, REEL_W, REEL_H],
  );
  return file;
}

/** Đường dẫn video mới nhất của revision (null nếu chưa dựng). */
export async function latestReelPath(db: pg.Pool, contentId: number, revision: number): Promise<string | null> {
  const r = await db.query<{ path: string }>(
    "SELECT path FROM media_asset WHERE content_id = $1 AND revision = $2 AND kind = 'VIDEO_FINAL' ORDER BY id DESC LIMIT 1",
    [contentId, revision],
  );
  return r.rows[0]?.path ?? null;
}

/** Chạy nền: ghi trạng thái pending, dựng, rồi ghi ready hoặc error. Không ném lỗi ra ngoài. */
export function startReelJob(deps: ReelDeps, contentId: number, revision: number, pkg: ContentPackage): void {
  const at = () => new Date().toISOString();
  void (async () => {
    await setReelStatus(deps.db, contentId, { state: 'pending', at: at() });
    try {
      await generateReel(deps, contentId, revision, pkg);
      await setReelStatus(deps.db, contentId, { state: 'ready', at: at() });
    } catch (e) {
      await setReelStatus(deps.db, contentId, { state: 'error', at: at(), error: (e as Error).message.slice(0, 200) });
    }
  })().catch(() => undefined);
}
