// Video Reels 9:16 cho một bài. PeaPod tạo job trên dịch vụ render, đọc tiến độ định kỳ và lưu MP4 khi xong.
// Trạng thái lưu trong app_config (khóa reel:<id>) nên không cần bảng mới. Tiến độ được ghi lại mỗi vài giây để giao diện hiển thị.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { ContentPackage } from '../domain/package.ts';
import { isReelStale, reelErrorText, type ReelStatus } from '../domain/reel.ts';
import { cardInputFrom } from '../media/card.ts';
import { RemoteError, type ReelRemote, type RemoteJob } from '../media/remote-card.ts';
import { getFlag, setFlag } from './appSettings.ts';

export type { ReelStatus } from '../domain/reel.ts';

export const REEL_W = 1080;
export const REEL_H = 1920;
/** Quá khoảng này chưa xong thì dừng job và báo lỗi. */
export const REEL_MAX_MS = 10 * 60_000;
const POLL_MS = 1500;
const MAX_POLL_FAILURES = 8;

export interface ReelDeps {
  db: pg.Pool;
  mediaDir: string;
  remote: ReelRemote;
  now?: () => Date;
  /** Tham số kiểm thử: khoảng hỏi tiến độ và thời hạn tối đa. */
  pollMs?: number;
  maxMs?: number;
}

const flagKey = (contentId: number) => `reel:${contentId}`;
const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readRaw(db: pg.Pool, contentId: number): Promise<ReelStatus | null> {
  const v = await getFlag(db, flagKey(contentId));
  return v ? (JSON.parse(v) as ReelStatus) : null;
}

async function writeRaw(db: pg.Pool, contentId: number, st: ReelStatus): Promise<void> {
  await setFlag(db, flagKey(contentId), JSON.stringify(st), 'system:reel');
}

/** Trạng thái hiện tại. Việc đang dựng nhưng không có cập nhật quá lâu được báo là gián đoạn để người dùng dựng lại. */
export async function reelStatus(db: pg.Pool, contentId: number, now = new Date()): Promise<ReelStatus | null> {
  const st = await readRaw(db, contentId);
  if (!st) return null;
  if (isReelStale(st, now)) {
    return { ...st, state: 'error', error: 'Việc dựng bị gián đoạn (máy chủ PeaPod hoặc dịch vụ render đã khởi động lại). Bấm dựng lại.' };
  }
  return st;
}

function vnDate(now: Date): string {
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now);
}

/** Ghi file MP4 của revision và bản ghi media_asset (kind VIDEO_FINAL). */
export async function saveReel(deps: Pick<ReelDeps, 'db' | 'mediaDir'>, contentId: number, revision: number, mp4: Buffer, now = new Date()): Promise<string> {
  if (mp4.length < 10_000) throw new Error('Video dựng ra quá nhỏ, không hợp lệ');
  const dir = path.join(deps.mediaDir, 'reels');
  await mkdir(dir, { recursive: true });
  // Tên có mốc thời gian để dựng lại không ghi đè video cũ (giữ lịch sử).
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

function errorOf(e: unknown): string {
  return e instanceof RemoteError || e instanceof Error ? e.message.slice(0, 200) : 'Lỗi không xác định khi dựng video.';
}

/**
 * Bắt đầu dựng: tạo job trên dịch vụ render rồi trả về ngay. Tiến độ được đọc nền.
 * Trả về trạng thái ban đầu (pending, hoặc error nếu không tạo được job).
 */
export async function startReelJob(deps: ReelDeps, contentId: number, revision: number, pkg: ContentPackage): Promise<ReelStatus> {
  const now = deps.now?.() ?? new Date();
  const input = cardInputFrom(pkg, vnDate(now));
  let jobId: string;
  try {
    jobId = await deps.remote.start(input);
  } catch (e) {
    const failed: ReelStatus = { state: 'error', at: nowIso(), revision, error: errorOf(e) };
    await writeRaw(deps.db, contentId, failed);
    return failed;
  }
  const st: ReelStatus = {
    state: 'pending', at: nowIso(), startedAt: nowIso(), revision, jobId,
    stage: 'queued', progress: 0, frames: 0, totalFrames: 0, etaSeconds: null,
  };
  await writeRaw(deps.db, contentId, st);
  void pollReel(deps, contentId, revision, jobId).catch(() => undefined);
  return st;
}

async function pollReel(deps: ReelDeps, contentId: number, revision: number, jobId: string): Promise<void> {
  const deadline = Date.now() + (deps.maxMs ?? REEL_MAX_MS);
  let failures = 0;
  for (;;) {
    await sleep(deps.pollMs ?? POLL_MS);
    const cur = await readRaw(deps.db, contentId);
    // Đã hủy, hoặc đã có lần dựng khác thay thế: dừng vòng lặp.
    if (!cur || cur.state !== 'pending' || cur.jobId !== jobId) return;

    if (Date.now() > deadline) {
      await deps.remote.cancel(jobId).catch(() => undefined);
      await writeRaw(deps.db, contentId, { ...cur, state: 'error', at: nowIso(), error: 'Quá 10 phút chưa dựng xong nên đã dừng. Thử dựng lại.' });
      return;
    }

    let job: RemoteJob;
    try {
      job = await deps.remote.status(jobId);
      failures = 0;
    } catch {
      // Lỗi tạm thời (mạng chập chờn) được bỏ qua; chỉ báo lỗi khi thất bại liên tiếp.
      failures++;
      if (failures >= MAX_POLL_FAILURES) {
        await writeRaw(deps.db, contentId, { ...cur, state: 'error', at: nowIso(), error: 'Mất kết nối tới dịch vụ render. Kiểm tra máy render rồi dựng lại.' });
        return;
      }
      continue;
    }

    if (job.state === 'done') {
      try {
        const mp4 = await deps.remote.video(jobId);
        await saveReel(deps, contentId, revision, mp4, deps.now?.() ?? new Date());
        await writeRaw(deps.db, contentId, { ...cur, state: 'ready', at: nowIso(), stage: undefined, progress: 1, etaSeconds: 0, error: undefined });
      } catch (e) {
        await writeRaw(deps.db, contentId, { ...cur, state: 'error', at: nowIso(), error: errorOf(e) });
      }
      return;
    }
    if (job.state === 'error') {
      await writeRaw(deps.db, contentId, { ...cur, state: 'error', at: nowIso(), error: reelErrorText(job.error) });
      return;
    }
    if (job.state === 'cancelled') {
      await writeRaw(deps.db, contentId, { ...cur, state: 'cancelled', at: nowIso() });
      return;
    }
    await writeRaw(deps.db, contentId, {
      ...cur,
      at: nowIso(),
      stage: job.state === 'queued' ? 'queued' : job.state === 'finalizing' ? 'finalizing' : 'rendering',
      progress: job.progress,
      frames: job.frames,
      totalFrames: job.totalFrames,
      etaSeconds: job.etaSeconds,
    });
  }
}

/** Hủy việc đang dựng. Dịch vụ render được báo dừng (nếu còn kết nối); PeaPod đánh dấu đã hủy ngay. */
export async function cancelReel(db: pg.Pool, remote: ReelRemote | null, contentId: number): Promise<boolean> {
  const cur = await readRaw(db, contentId);
  if (!cur || cur.state !== 'pending' || !cur.jobId) return false;
  await remote?.cancel(cur.jobId).catch(() => undefined);
  await writeRaw(db, contentId, { ...cur, state: 'cancelled', at: nowIso() });
  return true;
}
