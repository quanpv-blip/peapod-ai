// Gọi dịch vụ render Remotion (peapod-video) để lấy thẻ PNG và video Reels MP4. Lỗi, hết thời gian hoặc không cấu hình
// thì trả về null để bên gọi quay lại (thẻ: Satori; video: không có video). Token là bí mật: không ghi vào log hay thông báo lỗi.
import type { CardInput } from './card.ts';

export interface RemoteCardConfig {
  url: string;
  token: string;
  timeoutMs?: number;
}

/** Cấu hình từ môi trường. Thiếu URL hoặc token thì trả về null (tắt, dùng Satori). */
export function remoteCardConfigFromEnv(env: NodeJS.ProcessEnv = process.env): RemoteCardConfig | null {
  const url = env.REMOTION_RENDER_URL?.trim();
  const token = env.REMOTION_RENDER_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ''), token };
}

// Chỉ gửi đúng các trường của thẻ, không gửi thêm.
function cardBody(input: CardInput) {
  return { market: input.market, title: input.title, bullets: input.bullets, takeaway: input.takeaway, source: input.source, date: input.date };
}

async function postRender(path: string, input: CardInput, cfg: RemoteCardConfig, minBytes: number, timeoutMs: number, fetchFn: typeof fetch): Promise<Buffer | null> {
  try {
    const res = await fetchFn(`${cfg.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Token': cfg.token },
      body: JSON.stringify(cardBody(input)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const out = Buffer.from(await res.arrayBuffer());
    // File thật luôn lớn hơn vài trăm byte; phản hồi quá nhỏ coi như hỏng.
    return out.length > minBytes ? out : null;
  } catch {
    return null;
  }
}

/** Thẻ PNG 1080×1350. */
export function renderCardRemote(input: CardInput, cfg: RemoteCardConfig, fetchFn: typeof fetch = fetch): Promise<Buffer | null> {
  return postRender('/render/card', input, cfg, 1000, cfg.timeoutMs ?? 30_000, fetchFn);
}

/** Video Reels 1080×1920 (MP4), đồng bộ, không có tiến độ. Giữ cho tương thích; giao diện dùng job bên dưới. */
export function renderReelRemote(input: CardInput, cfg: RemoteCardConfig, fetchFn: typeof fetch = fetch): Promise<Buffer | null> {
  return postRender('/render/reel', input, cfg, 10_000, cfg.timeoutMs ?? 600_000, fetchFn);
}

// --- Job video: dịch vụ báo tiến độ, PeaPod hỏi định kỳ, tải về khi xong, có thể hủy ---

/** Lỗi có thông điệp an toàn để hiển thị cho người dùng (không chứa token hay nội dung gửi đi). */
export class RemoteError extends Error {}

export interface RemoteJob {
  id: string;
  state: 'queued' | 'rendering' | 'finalizing' | 'done' | 'error' | 'cancelled';
  progress: number;
  frames: number;
  totalFrames: number;
  etaSeconds: number | null;
  error: string | null;
  elapsedMs: number;
  /** Kết quả kiểm tra sau dựng (chỉ job VideoSpec). */
  review?: { verdict: 'pass' | 'pass_with_warnings' | 'revise'; failed: { id: string; severity: string; detail: string }[] };
}

/** Phần thêm cho video v2 (mẫu bố cục, phụ đề, lời đọc). Thiếu thì dịch vụ dựng bản 15 giây không tiếng. */
export interface ReelExtras {
  template?: 'list' | 'focus' | 'alert';
  captions?: { start: number; end: number; text: string }[];
  voiceSeconds?: number | null;
  /** WAV lời đọc, mã hóa base64. */
  audioBase64?: string | null;
}

export interface ReelRemote {
  start(input: CardInput, extras?: ReelExtras): Promise<string>;
  status(jobId: string): Promise<RemoteJob>;
  video(jobId: string): Promise<Buffer>;
  cancel(jobId: string): Promise<void>;
}

// --- Video v3: storyboard (AI viết nội dung) → engine VideoSpec của peapod-video ---

export interface StoryOptions {
  id: string;
  market: 'VN' | 'JP';
  source: { outlet: string; title: string; url: string; publishedAt?: string };
  incident?: boolean;
}

export interface StoryIssue {
  level: 'error' | 'warn';
  code: string;
  path: string;
  message: string;
}

export interface StoryCheck {
  ok: boolean;
  seconds: number;
  issues: StoryIssue[];
  /** Lời đọc từng cảnh theo thứ tự dựng: đọc TTS một lần cho cả video từ đúng văn bản này. */
  narration: string[];
}

export interface SpecRemote {
  check(storyboard: unknown, options: StoryOptions): Promise<StoryCheck>;
  /** Tạo job dựng. `audioWhole`: WAV lời đọc cả video (base64); thiếu thì dựng không tiếng. Trả id job (dùng chung API job với Reels). */
  start(storyboard: unknown, options: StoryOptions, audioWhole: string | null): Promise<string>;
}

export function makeSpecRemote(cfg: RemoteCardConfig, fetchFn: typeof fetch = fetch): SpecRemote {
  const headers = { 'X-Render-Token': cfg.token, 'Content-Type': 'application/json' };
  const unreachable = (): never => {
    throw new RemoteError('Không kết nối được dịch vụ render. Kiểm tra máy render đang chạy.');
  };
  return {
    async check(storyboard, options) {
      const res = await fetchFn(`${cfg.url}/storyboard/check`, { method: 'POST', headers, body: JSON.stringify({ storyboard, options }), signal: AbortSignal.timeout(20_000) }).catch(unreachable);
      const j = (await res.json().catch(() => null)) as (StoryCheck & { error?: string; issues?: { path: string; message: string }[] }) | null;
      if (res.status === 400 && j?.error === 'invalid_storyboard') {
        return { ok: false, seconds: 0, narration: [], issues: (j.issues ?? []).map((i) => ({ level: 'error' as const, code: 'structure', path: i.path, message: i.message })) };
      }
      if (!res.ok || !j) throw new RemoteError(`Dịch vụ render không kiểm được kịch bản (HTTP ${res.status}).`);
      return j;
    },
    async start(storyboard, options, audioWhole) {
      const res = await fetchFn(`${cfg.url}/jobs/spec`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ storyboard, options, ...(audioWhole ? { audioWhole } : { voice: 'silent' }) }),
        signal: AbortSignal.timeout(60_000),
      }).catch(unreachable);
      const j = (await res.json().catch(() => null)) as { id?: unknown; error?: string; seconds?: number; min?: number; max?: number; message?: string } | null;
      if (res.status === 422 && j?.error === 'duration_out_of_range') throw new RemoteError(`Lời đọc dài ${j.seconds} giây, ngoài khoảng ${j.min}–${j.max} giây cho phép.`);
      if (res.status === 400 && j?.error === 'invalid_audio') throw new RemoteError(`Lời đọc không dùng được: ${String(j.message ?? '').slice(0, 160)}`);
      if (res.status !== 202 || !j || typeof j.id !== 'string') throw new RemoteError(`Dịch vụ render từ chối yêu cầu (HTTP ${res.status}${j?.error ? `, ${j.error}` : ''}).`);
      return j.id;
    },
  };
}

export function makeReelRemote(cfg: RemoteCardConfig, fetchFn: typeof fetch = fetch): ReelRemote {
  const headers = { 'X-Render-Token': cfg.token };
  const url = (p: string) => `${cfg.url}${p}`;
  const unreachable = (): never => {
    throw new RemoteError('Không kết nối được dịch vụ render. Kiểm tra máy render đang chạy.');
  };
  return {
    async start(input, extras) {
      const res = await fetchFn(url('/jobs/reel'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...cardBody(input), ...(extras ?? {}) }),
        signal: AbortSignal.timeout(extras?.audioBase64 ? 60_000 : 15_000),
      }).catch(unreachable);
      if (res.status !== 202) throw new RemoteError(`Dịch vụ render từ chối yêu cầu (HTTP ${res.status}).`);
      const j = (await res.json().catch(() => null)) as { id?: unknown } | null;
      if (!j || typeof j.id !== 'string') throw new RemoteError('Dịch vụ render trả về phản hồi không hợp lệ.');
      return j.id;
    },
    async status(jobId) {
      const res = await fetchFn(url(`/jobs/${jobId}`), { headers, signal: AbortSignal.timeout(10_000) }).catch(unreachable);
      if (!res.ok) throw new RemoteError(`Không đọc được trạng thái dựng (HTTP ${res.status}).`);
      return (await res.json()) as RemoteJob;
    },
    async video(jobId) {
      const res = await fetchFn(url(`/jobs/${jobId}/video`), { headers, signal: AbortSignal.timeout(60_000) }).catch(unreachable);
      if (!res.ok) throw new RemoteError(`Không tải được video (HTTP ${res.status}).`);
      const out = Buffer.from(await res.arrayBuffer());
      if (out.length < 10_000) throw new RemoteError('Video tải về không hợp lệ.');
      return out;
    },
    async cancel(jobId) {
      await fetchFn(url(`/jobs/${jobId}`), { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    },
  };
}
