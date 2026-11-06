// Video Reels 9:16 cho một bài. PeaPod tạo job trên dịch vụ render, đọc tiến độ định kỳ và lưu MP4 khi xong.
// Trạng thái lưu trong app_config (khóa reel:<id>) nên không cần bảng mới. Tiến độ được ghi lại mỗi vài giây để giao diện hiển thị.
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type pg from 'pg';
import type { ContentPackage } from '../domain/package.ts';
import { isReelStale, reelErrorText, type ReelStatus } from '../domain/reel.ts';
import { cardInputFrom } from '../media/card.ts';
import { RemoteError, type ReelExtras, type ReelRemote, type RemoteJob, type SpecRemote, type StoryOptions } from '../media/remote-card.ts';
import { directorFix, directorSystem, directorUser, quoteIssues, type StoryboardLike } from '../domain/director.ts';
import { isIncidentText } from '../domain/autoApprove.ts';
import { buildReelCaptions, chooseTemplate, voiceDurationOk, voiceScript, VOICE_MAX_SEC, VOICE_MIN_SEC, type ReelTemplate } from '../domain/reelScript.ts';
import { parseWav } from '../domain/wav.ts';
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
  /** Sinh lời đọc (WAV) cho bài. Thiếu thì video không có tiếng. */
  tts?: (text: string, market: ContentPackage['market']) => Promise<Buffer>;
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
export async function startReelJob(deps: ReelDeps, contentId: number, revision: number, pkg: ContentPackage, template?: ReelTemplate): Promise<ReelStatus> {
  const now = deps.now?.() ?? new Date();
  const input = cardInputFrom(pkg, vnDate(now));
  const extras: ReelExtras = { template: template ?? chooseTemplate(pkg, input.bullets) };
  let voiceNote: string | undefined;
  // Lời đọc và phụ đề (tùy chọn): lỗi TTS không chặn việc dựng, video ra bản không tiếng và báo lý do.
  if (deps.tts) {
    try {
      const script = voiceScript(input.title, input.bullets, input.takeaway, pkg.market);
      const wav = await deps.tts(script, pkg.market);
      const sec = parseWav(wav).durationSec;
      if (!voiceDurationOk(sec)) throw new Error(`thời lượng lời đọc ${sec.toFixed(1)} giây nằm ngoài ${VOICE_MIN_SEC}-${VOICE_MAX_SEC} giây`);
      extras.voiceSeconds = Math.round(sec * 100) / 100;
      extras.captions = buildReelCaptions(script, sec, pkg.market);
      extras.audioBase64 = wav.toString('base64');
    } catch (e) {
      voiceNote = `Không tạo được lời đọc nên video không có tiếng: ${errorOf(e)}`;
    }
  }
  let jobId: string;
  try {
    jobId = await deps.remote.start(input, extras);
  } catch (e) {
    const failed: ReelStatus = { state: 'error', at: nowIso(), revision, error: errorOf(e) };
    await writeRaw(deps.db, contentId, failed);
    return failed;
  }
  const st: ReelStatus = {
    state: 'pending', at: nowIso(), startedAt: nowIso(), revision, jobId, note: voiceNote,
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
        await writeRaw(deps.db, contentId, { ...cur, state: 'ready', at: nowIso(), stage: undefined, progress: 1, etaSeconds: 0, error: undefined, ...(job.review ? { review: job.review.verdict } : {}) });
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
  if (!cur || cur.state !== 'pending') return false;
  // Video v3 đang ở bước viết kịch bản/đọc lời thì chưa có job: chỉ cần đánh dấu, luồng nền tự dừng trước khi tạo job.
  if (cur.jobId) await remote?.cancel(cur.jobId).catch(() => undefined);
  await writeRaw(db, contentId, { ...cur, state: 'cancelled', at: nowIso() });
  return true;
}

// --- Video v3: AI viết kịch bản phân cảnh → engine VideoSpec (peapod-video) kiểm tra và dựng ---

export interface StoryReelDeps extends ReelDeps {
  spec: SpecRemote;
  /** Gọi AI với lược đồ storyboard; trả JSON đã parse (hoặc null nếu AI trả sai JSON). */
  direct: (system: string, user: string) => Promise<unknown>;
  /** Tham số kiểm thử: thời gian chờ thử lại khi Gemini quá tải. */
  overloadWaitsMs?: number[];
  /** Tham số kiểm thử: nhịp báo còn sống. */
  heartbeatMs?: number;
}

export interface StorySource {
  /** Văn bản nguồn (tóm tắt RSS đã lưu). Câu trích chứng cứ phải nằm nguyên văn trong đây. Rỗng thì dùng bài đã duyệt. */
  text: string;
  outlet: string;
  /** Tiêu đề bài gốc (từ tin RSS); thiếu thì dùng sources[0].title của gói. */
  title?: string;
  publishedAt?: string;
}

/** Số lần AI được sửa kịch bản sau lần viết đầu (mỗi lần tốn một lượt gọi AI). */
export const DIRECTOR_FIXES = 2;

/** Bản nháp kịch bản của từng lần AI viết, lưu để xem lại khi lỗi (app_config, khóa reel-draft:<id>). */
export interface StoryDraft {
  attempt: number;
  storyboard: unknown;
  problems: string[];
  warnings: string[];
}
export const draftKey = (contentId: number) => `reel-draft:${contentId}`;

async function saveDrafts(db: pg.Pool, contentId: number, revision: number, drafts: StoryDraft[]): Promise<void> {
  await setFlag(db, draftKey(contentId), JSON.stringify({ at: nowIso(), revision, drafts }), 'system:reel');
}

/** Các bản nháp kịch bản của lần dựng v3 gần nhất (null nếu chưa có). */
export async function storyDrafts(db: pg.Pool, contentId: number): Promise<{ at: string; revision: number; drafts: StoryDraft[] } | null> {
  const v = await getFlag(db, draftKey(contentId));
  return v ? (JSON.parse(v) as { at: string; revision: number; drafts: StoryDraft[] }) : null;
}
/** Chờ trước mỗi lần thử lại khi MỌI mô hình đều báo quá tải (503). Hết hạn mức (429) thì không chờ. */
export const OVERLOAD_WAITS_MS = [20_000, 40_000, 60_000];
const CANCELLED = Symbol('cancelled');

/**
 * Đáng thử lại: ít nhất một mô hình chỉ lỗi tạm thời (quá tải, quá chậm), các mô hình còn lại hoặc tạm thời hoặc đã hết
 * hạn mức. Không thử lại khi có lỗi từ chối yêu cầu/khóa sai (thử lại cũng vậy) hoặc khi MỌI mô hình đều hết hạn mức.
 * (Đã gặp ở bài #27: 3.6 hết hạn mức, ba mô hình kia quá tải → trước đây bỏ cuộc ngay.)
 */
export function worthRetry(e: unknown): boolean {
  const reasons = (e as { reasons?: unknown }).reasons;
  if (!Array.isArray(reasons) || reasons.length === 0) return false;
  const transient = (r: unknown) => typeof r === 'string' && (r.endsWith('đang quá tải') || r.endsWith('phản hồi quá chậm'));
  const exhausted = (r: unknown) => typeof r === 'string' && r.endsWith('hết hạn mức trong ngày');
  return reasons.some(transient) && reasons.every((r) => transient(r) || exhausted(r));
}

/**
 * Gọi đạo diễn AI; Gemini quá tải thì chờ rồi thử lại. Trong lúc chờ vẫn ghi trạng thái (để không bị coi là treo)
 * và hiện cho người dùng biết đang chờ. Người dùng hủy trong lúc chờ thì dừng.
 */
async function directWithRetry(deps: StoryReelDeps, contentId: number, still: () => Promise<ReelStatus | null>, system: string, user: string): Promise<unknown> {
  const waits = deps.overloadWaitsMs ?? OVERLOAD_WAITS_MS;
  for (let i = 0; ; i++) {
    try {
      return await deps.direct(system, user);
    } catch (e) {
      if (!worthRetry(e) || i >= waits.length) throw e;
      const cur = await still();
      if (!cur) return CANCELLED;
      const ms = waits[i]!;
      await writeRaw(deps.db, contentId, { ...cur, at: nowIso(), waiting: `Gemini đang quá tải, tự thử lại sau ${Math.round(ms / 1000)} giây (lần ${i + 1}/${waits.length})` });
      await sleep(ms);
      const after = await still();
      if (!after) return CANCELLED;
      await writeRaw(deps.db, contentId, { ...after, at: nowIso(), waiting: undefined });
    }
  }
}

const clipText = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…');

/** Bắt đầu video v3. Trả ngay trạng thái "đang viết kịch bản"; các bước sau chạy nền và ghi tiến độ. */
export async function startStoryReel(deps: StoryReelDeps, contentId: number, revision: number, pkg: ContentPackage, source: StorySource): Promise<ReelStatus> {
  const st: ReelStatus = { state: 'pending', engine: 'v3', at: nowIso(), startedAt: nowIso(), revision, stage: 'directing', progress: 0, frames: 0, totalFrames: 0, etaSeconds: null };
  await writeRaw(deps.db, contentId, st);
  void runStoryReel(deps, contentId, revision, pkg, source).catch(async (e) => {
    const cur = await readRaw(deps.db, contentId);
    if (cur?.state === 'pending' && !cur.jobId) await writeRaw(deps.db, contentId, { ...cur, state: 'error', at: nowIso(), error: errorOf(e) });
  });
  return st;
}

/** Nhịp báo còn sống khi AI viết kịch bản/đọc lời lâu (một lượt AI có thể mất tới vài phút khi chuyển qua nhiều mô hình). */
export const STORY_HEARTBEAT_MS = 30_000;

async function runStoryReel(deps: StoryReelDeps, contentId: number, revision: number, pkg: ContentPackage, source: StorySource): Promise<void> {
  // Không có nhịp này thì quá REEL_STALE_MS (3 phút) không cập nhật sẽ bị coi là "gián đoạn" dù vẫn đang chạy (đã gặp ở bài #27).
  // Chỉ chạy trước khi có job dựng; sau đó pollReel cập nhật đều đặn.
  let inflight: Promise<void> | null = null;
  const beat = setInterval(() => {
    if (inflight) return;
    inflight = (async () => {
      const cur = await readRaw(deps.db, contentId);
      if (cur && cur.state === 'pending' && cur.revision === revision && !cur.jobId) await writeRaw(deps.db, contentId, { ...cur, at: nowIso() });
    })()
      .catch(() => undefined)
      .finally(() => (inflight = null));
  }, deps.heartbeatMs ?? STORY_HEARTBEAT_MS);
  // Dừng nhịp VÀ chờ lần ghi đang dở xong, để nó không ghi đè trạng thái mới (mất jobId, hay đè lỗi bằng "đang dựng").
  const stopBeat = async () => {
    clearInterval(beat);
    await inflight;
  };
  try {
    await runStoryReelSteps(deps, contentId, revision, pkg, source, stopBeat);
  } finally {
    await stopBeat();
  }
}

async function runStoryReelSteps(deps: StoryReelDeps, contentId: number, revision: number, pkg: ContentPackage, source: StorySource, stopBeat: () => Promise<void>): Promise<void> {
  const still = async () => {
    const cur = await readRaw(deps.db, contentId);
    return cur && cur.state === 'pending' && cur.revision === revision && !cur.jobId ? cur : null;
  };
  const src = pkg.sources[0]!;
  const options: StoryOptions = {
    id: `p${contentId}-r${revision}`,
    market: pkg.market,
    source: { outlet: clipText(source.outlet || new URL(src.url).hostname, 60), title: clipText(source.title || src.title, 160), url: src.url, ...(source.publishedAt ? { publishedAt: source.publishedAt } : {}) },
    incident: isIncidentText(`${pkg.post.headline}\n${pkg.post.body}`),
  };
  // Câu trích được lấy từ văn bản nguồn RSS HOẶC bài đã duyệt (bài viết từ nguồn và đã qua người duyệt). Tóm tắt RSS thường
  // chỉ vài câu nên chỉ dựa vào nó thì AI gần như không có số để dùng (đã gặp: bài #27, nguồn 224 ký tự).
  const allowed = `${source.text}\n${pkg.post.headline}\n${pkg.post.body}`;
  const system = directorSystem(pkg.market);

  // 1) AI viết kịch bản; engine kiểm tra; sai thì cho AI sửa (có giới hạn).
  let storyboard: unknown = null;
  let narration: string[] = [];
  let problems: string[] = [];
  const drafts: StoryDraft[] = [];
  for (let attempt = 0; attempt <= DIRECTOR_FIXES; attempt++) {
    const user = attempt === 0 ? directorUser(pkg, source.text) : `${directorUser(pkg, source.text)}\n\n${directorFix(storyboard, problems, pkg.market)}`;
    const json = await directWithRetry(deps, contentId, still, system, user);
    if (json === CANCELLED) return;
    if (!(await still())) return;
    if (!json || typeof json !== 'object' || !Array.isArray((json as StoryboardLike).scenes)) {
      storyboard = json;
      problems = ['Trả lời không phải JSON kịch bản hợp lệ (thiếu "scenes").'];
      drafts.push({ attempt: attempt + 1, storyboard: json, problems, warnings: [] });
      continue;
    }
    storyboard = json;
    const quoteProblems = quoteIssues(json as StoryboardLike, allowed);
    const check = await deps.spec.check(json, options);
    problems = [...quoteProblems, ...check.issues.filter((i) => i.level === 'error').map((i) => `${i.path}: ${i.message}`)];
    narration = check.narration;
    drafts.push({ attempt: attempt + 1, storyboard: json, problems, warnings: check.issues.filter((i) => i.level === 'warn').map((i) => `${i.path}: ${i.message}`).slice(0, 10) });
    await saveDrafts(deps.db, contentId, revision, drafts);
    if (!problems.length) break;
  }
  if (problems.length) {
    await saveDrafts(deps.db, contentId, revision, drafts);
    const more = problems.length > 2 ? ` (và ${problems.length - 2} lỗi khác)` : '';
    throw new Error(`AI chưa viết được kịch bản hợp lệ sau ${DIRECTOR_FIXES + 1} lần. ${problems.slice(0, 2).join(' · ')}${more}`);
  }

  // 2) Lời đọc: MỘT lần TTS cho cả video (engine tự cắt theo cảnh). Lỗi TTS: dựng bản không tiếng và ghi chú.
  let cur = await still();
  if (!cur) return;
  await writeRaw(deps.db, contentId, { ...cur, at: nowIso(), stage: 'voicing' });
  let audioWhole: string | null = null;
  let note: string | undefined;
  if (deps.tts && narration.length) {
    try {
      // Xuống dòng đôi giữa các cảnh để giọng đọc ngừng rõ ở ranh giới cảnh (engine cắt ở các chỗ ngừng này).
      const wav = await deps.tts(narration.join('\n\n'), pkg.market);
      parseWav(wav); // hỏng thì ném lỗi ngay
      audioWhole = wav.toString('base64');
    } catch (e) {
      note = `Không tạo được lời đọc nên video không có tiếng: ${errorOf(e)}`;
    }
  } else note = 'Chưa bật lời đọc nên video không có tiếng.';

  // 3) Tạo job dựng rồi theo dõi như video thường.
  cur = await still();
  if (!cur) return;
  const jobId = await deps.spec.start(storyboard, options, audioWhole);
  await stopBeat();
  // Người dùng có thể đã hủy trong lúc job đang được tạo: không "làm sống lại" việc đã hủy, hủy luôn job vừa tạo.
  const fresh = await still();
  if (!fresh) {
    await deps.remote.cancel(jobId).catch(() => undefined);
    return;
  }
  await writeRaw(deps.db, contentId, { ...fresh, at: nowIso(), jobId, stage: 'queued', note, waiting: undefined });
  await pollReel(deps, contentId, revision, jobId);
}
