import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { ContentPackage } from '../src/domain/package.ts';
import type { ReelStatus } from '../src/domain/reel.ts';
import { createGenerated } from '../src/services/contents.ts';
import { setFlag } from '../src/services/appSettings.ts';
import { cancelReel, latestReelPath, reelStatus, REEL_H, REEL_W, saveReel, startReelJob, type ReelDeps } from '../src/services/reels.ts';
import { RemoteError, type ReelRemote, type RemoteJob } from '../src/media/remote-card.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql'];

const pkg = (n: number): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline: `Tin video ${n}`, body: 'Nhận định của chúng tôi: Thị trường đang mở rộng.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#CN'] },
  sources: [{ title: 'VnExpress', url: `https://vnexpress.net/v${n}` }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});

// Mp4 giả đủ lớn để qua bước kiểm tra kích thước; nội dung không cần là video thật.
const fakeMp4 = Buffer.alloc(20_000, 7);

const job = (over: Partial<RemoteJob>): RemoteJob => ({
  id: 'job-1', state: 'rendering', progress: 0, frames: 0, totalFrames: 450, etaSeconds: null, error: null, elapsedMs: 0, ...over,
});

/** Dịch vụ render giả: trả lần lượt các trạng thái, dừng ở trạng thái cuối. */
function fakeRemote(states: RemoteJob[], opts: { startError?: Error; video?: Buffer } = {}) {
  let i = 0;
  const remote = {
    cancels: 0,
    async start(): Promise<string> {
      if (opts.startError) throw opts.startError;
      return 'job-1';
    },
    async status(): Promise<RemoteJob> {
      const s = states[Math.min(i, states.length - 1)]!;
      i++;
      return s;
    },
    async video(): Promise<Buffer> {
      return opts.video ?? fakeMp4;
    },
    async cancel(): Promise<void> {
      remote.cancels++;
    },
  };
  return remote as typeof remote & ReelRemote;
}

d('video Reels 9:16 (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
  let media: string;
  const deps = (remote: ReelRemote, extra: Partial<ReelDeps> = {}): ReelDeps => ({ db, mediaDir: media, remote, pollMs: 5, maxMs: 5_000, ...extra });

  beforeAll(async () => {
    const f = await freshDb(URL_!, MIGRATIONS);
    db = f.db;
    drop = f.drop;
    media = mkdtempSync(join(tmpdir(), 'pp-reel-'));
  });
  afterAll(async () => {
    await drop?.();
    rmSync(media, { recursive: true, force: true });
  });

  it('lưu video: ghi file MP4 và media_asset kind VIDEO_FINAL 1080×1920', async () => {
    const id = await createGenerated(db, pkg(1), 'test');
    const file = await saveReel({ db, mediaDir: media }, id, 1, fakeMp4);
    expect(file.endsWith('.mp4')).toBe(true);
    expect(readFileSync(file).equals(fakeMp4)).toBe(true);
    const row = (await db.query("SELECT kind, width, height FROM media_asset WHERE content_id = $1 AND kind = 'VIDEO_FINAL'", [id])).rows[0];
    expect(row).toMatchObject({ kind: 'VIDEO_FINAL', width: REEL_W, height: REEL_H });
    expect(await latestReelPath(db, id, 1)).toBe(file);
  });

  it('video quá nhỏ bị từ chối và không ghi gì', async () => {
    const id = await createGenerated(db, pkg(2), 'test');
    await expect(saveReel({ db, mediaDir: media }, id, 1, Buffer.alloc(10))).rejects.toThrow('quá nhỏ');
    expect(await latestReelPath(db, id, 1)).toBeNull();
  });

  it('job thành công: tiến độ được ghi lại rồi chuyển sang ready kèm file', async () => {
    const id = await createGenerated(db, pkg(3), 'test');
    const remote = fakeRemote([
      job({ state: 'queued', progress: 0 }),
      job({ state: 'rendering', progress: 0.4, frames: 180, etaSeconds: 7 }),
      job({ state: 'finalizing', progress: 0.99, frames: 450, etaSeconds: 1 }),
      job({ state: 'done', progress: 1, frames: 450, etaSeconds: 0 }),
    ]);
    const st = await startReelJob(deps(remote), id, 1, pkg(3));
    expect(st.state).toBe('pending');
    expect(st.stage).toBe('queued');
    await waitFor(async () => (await reelStatus(db, id))?.state === 'ready');
    const done = await reelStatus(db, id);
    expect(done?.state).toBe('ready');
    expect(done?.progress).toBe(1);
    expect(await latestReelPath(db, id, 1)).not.toBeNull();
  });

  it('job lỗi phía dịch vụ: hiện lý do tiếng Việt, không để trạng thái treo', async () => {
    const id = await createGenerated(db, pkg(4), 'test');
    await startReelJob(deps(fakeRemote([job({ state: 'error', error: 'render_failed' })])), id, 1, pkg(4));
    await waitFor(async () => (await reelStatus(db, id))?.state === 'error');
    const st = await reelStatus(db, id);
    expect(st?.error).toContain('Dịch vụ render gặp lỗi');
  });

  it('không tạo được job: trả về error ngay, không có việc nào đang chạy', async () => {
    const id = await createGenerated(db, pkg(5), 'test');
    const remote = fakeRemote([], { startError: new RemoteError('Không kết nối được dịch vụ render.') });
    const st = await startReelJob(deps(remote), id, 1, pkg(5));
    expect(st.state).toBe('error');
    expect(st.error).toBe('Không kết nối được dịch vụ render.');
    expect((await reelStatus(db, id))?.state).toBe('error');
  });

  it('hủy giữa chừng: trạng thái thành cancelled, dịch vụ được báo dừng, vòng hỏi tiến độ dừng hẳn', async () => {
    const id = await createGenerated(db, pkg(6), 'test');
    const remote = fakeRemote([job({ state: 'rendering', progress: 0.3, frames: 135 })]);
    await startReelJob(deps(remote), id, 1, pkg(6));
    await waitFor(async () => (await reelStatus(db, id))?.progress === 0.3);
    expect(await cancelReel(db, remote, id)).toBe(true);
    expect(remote.cancels).toBe(1);
    await new Promise((r) => setTimeout(r, 60));
    expect((await reelStatus(db, id))?.state).toBe('cancelled');
    expect(await latestReelPath(db, id, 1)).toBeNull();
  });

  it('quá thời hạn: dừng job và báo lỗi rõ ràng', async () => {
    const id = await createGenerated(db, pkg(7), 'test');
    const remote = fakeRemote([job({ state: 'rendering', progress: 0.01 })]);
    await startReelJob(deps(remote, { maxMs: 40 }), id, 1, pkg(7));
    await waitFor(async () => (await reelStatus(db, id))?.state === 'error');
    expect((await reelStatus(db, id))?.error).toContain('Quá 10 phút');
    expect(remote.cancels).toBe(1);
  });

  it('việc treo quá lâu (máy chủ khởi động lại giữa chừng) được báo là gián đoạn và cho phép dựng lại', async () => {
    const id = await createGenerated(db, pkg(8), 'test');
    const old: ReelStatus = { state: 'pending', at: new Date(Date.now() - 10 * 60_000).toISOString(), jobId: 'lost', stage: 'rendering', progress: 0.2 };
    await setFlag(db, `reel:${id}`, JSON.stringify(old), 'test');
    const st = await reelStatus(db, id);
    expect(st?.state).toBe('error');
    expect(st?.error).toContain('gián đoạn');
  });

  it('file đã tạo nằm đúng trong thư mục media', () => {
    expect(existsSync(join(media, 'reels'))).toBe(true);
  });
});

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}
