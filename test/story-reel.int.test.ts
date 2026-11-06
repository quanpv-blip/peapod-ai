import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import type { ContentPackage } from '../src/domain/package.ts';
import type { ReelStatus } from '../src/domain/reel.ts';
import { createGenerated } from '../src/services/contents.ts';
import { cancelReel, reelStatus, startStoryReel, type StoryReelDeps } from '../src/services/reels.ts';
import type { ReelRemote, RemoteJob, SpecRemote, StoryCheck } from '../src/media/remote-card.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql'];

const SOURCE = 'Carrefour cho biết 15 trong số 700 cửa hàng của họ tại Bỉ bị ảnh hưởng.';
const pkg = (n: number): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline: `Tủ đông bị hack ${n}`, body: 'Nhận định: thiết bị nối mạng là điểm yếu của bán lẻ.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#CN'] },
  sources: [{ title: 'Hacker tăng nhiệt tủ lạnh', url: `https://vnexpress.net/s${n}` }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});

const goodBoard = {
  facts: [{ id: 'f-c', label: 'Cửa hàng Carrefour bị ảnh hưởng', value: 15, raw: '15', unit: 'cửa hàng', quote: 'Carrefour cho biết 15 trong số 700 cửa hàng của họ tại Bỉ bị ảnh hưởng.' }],
  scenes: [{ type: 'hook', headline: 'Tủ đông bị hack', say: ['Tủ đông bị hack.'] }, { type: 'stat', factId: 'f-c', say: ['15 cửa hàng.'] }, { type: 'cta', question: 'Bạn nghĩ sao?', say: ['Bạn nghĩ sao?'] }],
};
const badQuote = { ...goodBoard, facts: [{ ...goodBoard.facts[0]!, quote: 'Có 15 cửa hàng bị ảnh hưởng theo Carrefour.' }] };

const okCheck: StoryCheck = { ok: true, seconds: 40, issues: [], narration: ['Tủ đông bị hack.', '15 cửa hàng.', 'Bạn nghĩ sao?'] };
const wav = (() => {
  const n = 24000;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(24000, 24); b.writeUInt32LE(48000, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  return b;
})();

const doneJob: RemoteJob = { id: 'job-v3', state: 'done', progress: 1, frames: 900, totalFrames: 900, etaSeconds: 0, error: null, elapsedMs: 10, review: { verdict: 'pass_with_warnings', failed: [] } };

function fakes(boards: unknown[], checks: StoryCheck[] = [okCheck]) {
  const calls = { direct: 0, check: 0, start: [] as { audio: string | null }[], tts: 0 };
  const spec: SpecRemote = {
    async check() {
      return checks[Math.min(calls.check++, checks.length - 1)]!;
    },
    async start(_sb, _op, audio) {
      calls.start.push({ audio });
      return 'job-v3';
    },
  };
  const remote = { async start() { return 'x'; }, async status() { return doneJob; }, async video() { return Buffer.alloc(20_000, 1); }, async cancel() {} } as ReelRemote;
  const direct = async () => boards[Math.min(calls.direct++, boards.length - 1)];
  const tts = async () => {
    calls.tts++;
    return wav;
  };
  return { spec, remote, direct, tts, calls };
}

async function waitState(db: pg.Pool, id: number, states: ReelStatus['state'][]): Promise<ReelStatus> {
  for (let i = 0; i < 200; i++) {
    const st = await reelStatus(db, id);
    if (st && states.includes(st.state)) return st;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('quá thời gian chờ');
}

d('video v3: AI viết kịch bản → engine dựng (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
  let media: string;
  const deps = (f: ReturnType<typeof fakes>): StoryReelDeps => ({ db, mediaDir: media, remote: f.remote, spec: f.spec, direct: f.direct, tts: f.tts, pollMs: 5, maxMs: 5_000 });

  beforeAll(async () => {
    const x = await freshDb(URL_!, MIGRATIONS);
    db = x.db;
    drop = x.drop;
    media = mkdtempSync(join(tmpdir(), 'pp-v3-'));
  });
  afterAll(async () => {
    await drop?.();
    rmSync(media, { recursive: true, force: true });
  });

  it('kịch bản hợp lệ: một lần gọi AI, một lần TTS cho cả video, gửi kèm giọng, lưu video và kết quả kiểm tra', async () => {
    const id = await createGenerated(db, pkg(1), 'test');
    const f = fakes([goodBoard]);
    const st = await startStoryReel(deps(f), id, 1, pkg(1), { text: SOURCE, outlet: 'vnexpress.net' });
    expect(st).toMatchObject({ state: 'pending', stage: 'directing', engine: 'v3' });
    const end = await waitState(db, id, ['ready', 'error']);
    expect(end.state).toBe('ready');
    expect(end.review).toBe('pass_with_warnings');
    expect(f.calls.direct).toBe(1);
    expect(f.calls.tts).toBe(1);
    expect(f.calls.start[0]!.audio).toBe(wav.toString('base64'));
  });

  it('câu trích không nguyên văn từ nguồn: AI được sửa một lần rồi đạt', async () => {
    const id = await createGenerated(db, pkg(2), 'test');
    const f = fakes([badQuote, goodBoard]);
    await startStoryReel(deps(f), id, 1, pkg(2), { text: SOURCE, outlet: 'vnexpress.net' });
    expect((await waitState(db, id, ['ready', 'error'])).state).toBe('ready');
    expect(f.calls.direct).toBe(2);
  });

  it('vẫn sai sau khi sửa: báo lỗi rõ, không tạo job dựng, không tốn TTS', async () => {
    const id = await createGenerated(db, pkg(3), 'test');
    const f = fakes([badQuote]);
    await startStoryReel(deps(f), id, 1, pkg(3), { text: SOURCE, outlet: 'vnexpress.net' });
    const end = await waitState(db, id, ['error']);
    expect(end.error).toMatch(/chép nguyên văn/);
    expect(f.calls.start).toHaveLength(0);
    expect(f.calls.tts).toBe(0);
  });

  it('engine báo lỗi kịch bản (ví dụ số không có chứng cứ): chuyển lỗi cho AI sửa', async () => {
    const id = await createGenerated(db, pkg(4), 'test');
    const bad: StoryCheck = { ok: false, seconds: 40, narration: [], issues: [{ level: 'error', code: 'number-no-evidence', path: 'scenes[1].narration.text', message: 'Số "700" không khớp fact nào.' }] };
    const f = fakes([goodBoard, goodBoard], [bad, okCheck]);
    await startStoryReel(deps(f), id, 1, pkg(4), { text: SOURCE, outlet: 'vnexpress.net' });
    expect((await waitState(db, id, ['ready', 'error'])).state).toBe('ready');
    expect(f.calls.direct).toBe(2);
  });

  it('TTS lỗi: vẫn dựng bản không tiếng và ghi chú lý do', async () => {
    const id = await createGenerated(db, pkg(5), 'test');
    const f = fakes([goodBoard]);
    const dep = { ...deps(f), tts: async () => { throw new Error('hết hạn mức'); } };
    await startStoryReel(dep, id, 1, pkg(5), { text: SOURCE, outlet: 'vnexpress.net' });
    const end = await waitState(db, id, ['ready', 'error']);
    expect(end.state).toBe('ready');
    expect(end.note).toMatch(/không có tiếng/);
    expect(f.calls.start[0]!.audio).toBeNull();
  });

  it('Gemini quá tải: chờ rồi tự thử lại, đạt thì dựng tiếp; hết lượt thử thì báo lỗi', async () => {
    const { AiUnavailableError } = await import('../src/providers/aiChain.ts');
    const overloaded = () => new AiUnavailableError(['gemini-3.6-flash: đang quá tải', 'gemini-3.5-flash: đang quá tải']);
    const id = await createGenerated(db, pkg(7), 'test');
    const f = fakes([goodBoard]);
    let n = 0;
    const dep = { ...deps(f), overloadWaitsMs: [5, 5], direct: async () => { if (n++ < 2) throw overloaded(); return goodBoard; } };
    await startStoryReel(dep, id, 1, pkg(7), { text: SOURCE, outlet: 'vnexpress.net' });
    expect((await waitState(db, id, ['ready', 'error'])).state).toBe('ready');
    expect(n).toBe(3);

    const id2 = await createGenerated(db, pkg(8), 'test');
    const dep2 = { ...deps(fakes([goodBoard])), overloadWaitsMs: [5], direct: async () => { throw overloaded(); } };
    await startStoryReel(dep2, id2, 1, pkg(8), { text: SOURCE, outlet: 'vnexpress.net' });
    expect((await waitState(db, id2, ['error'])).error).toMatch(/quá tải/);
  });

  it('mọi mô hình hết hạn mức: báo lỗi ngay, không chờ', async () => {
    const { AiUnavailableError } = await import('../src/providers/aiChain.ts');
    const id = await createGenerated(db, pkg(9), 'test');
    let n = 0;
    const dep = { ...deps(fakes([goodBoard])), overloadWaitsMs: [5, 5], direct: async () => { n++; throw new AiUnavailableError(['gemini-3.6-flash: hết hạn mức trong ngày', 'gemini-3.5-flash: hết hạn mức trong ngày']); } };
    await startStoryReel(dep, id, 1, pkg(9), { text: SOURCE, outlet: 'vnexpress.net' });
    expect((await waitState(db, id, ['error'])).error).toMatch(/hạn mức/);
    expect(n).toBe(1);
  });

  it('AI viết lâu: nhịp báo còn sống giữ trạng thái mới, không bị coi là gián đoạn', async () => {
    const id = await createGenerated(db, pkg(10), 'test');
    const f = fakes([goodBoard]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const dep = { ...deps(f), heartbeatMs: 10, direct: async () => { await gate; return goodBoard; } };
    await startStoryReel(dep, id, 1, pkg(10), { text: SOURCE, outlet: 'vnexpress.net' });
    const first = (await reelStatus(db, id))!.at;
    await new Promise((r) => setTimeout(r, 80));
    const later = (await reelStatus(db, id))!;
    expect(later.state).toBe('pending');
    expect(Date.parse(later.at)).toBeGreaterThan(Date.parse(first));
    release();
    const end = await waitState(db, id, ['ready', 'error']);
    expect(end.state).toBe('ready');
    expect(end.jobId).toBe('job-v3'); // nhịp không ghi đè mất jobId
  });

  it('hủy khi AI đang viết kịch bản: không tạo job dựng', async () => {
    const id = await createGenerated(db, pkg(6), 'test');
    const f = fakes([goodBoard]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const dep = { ...deps(f), direct: async () => { await gate; return goodBoard; } };
    await startStoryReel(dep, id, 1, pkg(6), { text: SOURCE, outlet: 'vnexpress.net' });
    expect(await cancelReel(db, null, id)).toBe(true);
    release();
    await new Promise((r) => setTimeout(r, 60));
    expect((await reelStatus(db, id))!.state).toBe('cancelled');
    expect(f.calls.start).toHaveLength(0);
  });
});
