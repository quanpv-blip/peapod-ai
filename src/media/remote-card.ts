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
}

export interface ReelRemote {
  start(input: CardInput): Promise<string>;
  status(jobId: string): Promise<RemoteJob>;
  video(jobId: string): Promise<Buffer>;
  cancel(jobId: string): Promise<void>;
}

export function makeReelRemote(cfg: RemoteCardConfig, fetchFn: typeof fetch = fetch): ReelRemote {
  const headers = { 'X-Render-Token': cfg.token };
  const url = (p: string) => `${cfg.url}${p}`;
  const unreachable = (): never => {
    throw new RemoteError('Không kết nối được dịch vụ render. Kiểm tra máy render đang chạy.');
  };
  return {
    async start(input) {
      const res = await fetchFn(url('/jobs/reel'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(cardBody(input)),
        signal: AbortSignal.timeout(15_000),
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
