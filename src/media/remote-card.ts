// Gọi dịch vụ render Remotion (peapod-video) để lấy PNG thẻ. Lỗi, hết thời gian hoặc không cấu hình thì trả về null
// để bên gọi quay lại Satori. Token là bí mật: không ghi vào log hay thông báo lỗi.
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

export async function renderCardRemote(input: CardInput, cfg: RemoteCardConfig, fetchFn: typeof fetch = fetch): Promise<Buffer | null> {
  // Chỉ gửi đúng các trường của thẻ, không gửi thêm.
  const body = {
    market: input.market,
    title: input.title,
    bullets: input.bullets,
    takeaway: input.takeaway,
    source: input.source,
    date: input.date,
  };
  try {
    const res = await fetchFn(`${cfg.url}/render/card`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Render-Token': cfg.token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(cfg.timeoutMs ?? 30_000),
    });
    if (!res.ok) return null;
    const png = Buffer.from(await res.arrayBuffer());
    // PNG thật luôn lớn hơn vài trăm byte; phản hồi quá nhỏ coi như hỏng.
    return png.length > 1000 ? png : null;
  } catch {
    return null;
  }
}
