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

/** Video Reels 1080×1920 (MP4). Render mất vài giây đến vài chục giây, nên thời gian chờ dài hơn. */
export function renderReelRemote(input: CardInput, cfg: RemoteCardConfig, fetchFn: typeof fetch = fetch): Promise<Buffer | null> {
  return postRender('/render/reel', input, cfg, 10_000, cfg.timeoutMs ?? 600_000, fetchFn);
}
