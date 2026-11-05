import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { ContentPackage } from '../src/domain/package.ts';
import { createGenerated } from '../src/services/contents.ts';
import { generateReel, latestReelPath, reelStatus, startReelJob, REEL_H, REEL_W } from '../src/services/reels.ts';
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

d('video Reels 9:16 (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
  let media: string;

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

  it('dựng video: ghi file MP4 và media_asset kind VIDEO_FINAL 1080×1920', async () => {
    const id = await createGenerated(db, pkg(1), 'test');
    const file = await generateReel({ db, mediaDir: media, renderReel: async () => fakeMp4 }, id, 1, pkg(1));
    expect(file.endsWith('.mp4')).toBe(true);
    expect(readFileSync(file).equals(fakeMp4)).toBe(true);
    const row = (await db.query("SELECT kind, width, height FROM media_asset WHERE content_id = $1 AND kind = 'VIDEO_FINAL'", [id])).rows[0];
    expect(row).toMatchObject({ kind: 'VIDEO_FINAL', width: REEL_W, height: REEL_H });
    expect(await latestReelPath(db, id, 1)).toBe(file);
  });

  it('dịch vụ không trả video thì ném lỗi và không ghi gì', async () => {
    const id = await createGenerated(db, pkg(2), 'test');
    await expect(generateReel({ db, mediaDir: media, renderReel: async () => null }, id, 1, pkg(2))).rejects.toThrow('không trả về video');
    expect(await latestReelPath(db, id, 1)).toBeNull();
  });

  it('chạy nền: trạng thái pending rồi ready; lỗi thì ghi error kèm lý do', async () => {
    const ok = await createGenerated(db, pkg(3), 'test');
    startReelJob({ db, mediaDir: media, renderReel: async () => fakeMp4 }, ok, 1, pkg(3));
    await waitFor(async () => (await reelStatus(db, ok))?.state === 'ready');
    expect((await reelStatus(db, ok))?.state).toBe('ready');

    const bad = await createGenerated(db, pkg(4), 'test');
    startReelJob({ db, mediaDir: media, renderReel: async () => null }, bad, 1, pkg(4));
    await waitFor(async () => (await reelStatus(db, bad))?.state === 'error');
    const st = await reelStatus(db, bad);
    expect(st?.state).toBe('error');
    expect(st?.error).toContain('không trả về video');
  });

  it('file đã tạo nằm đúng trong thư mục media', () => {
    expect(existsSync(join(media, 'reels'))).toBe(true);
  });
});

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
}
