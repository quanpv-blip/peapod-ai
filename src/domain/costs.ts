// Bảng giá và hàm tính chi phí xAI. Nguồn giá: https://docs.x.ai/docs/models (đối chiếu 2026-11-02, E-01).
// Giá công cụ tìm kiếm CHƯA xác nhận từ nguồn chính thức (E-06) nên để ở đây dưới dạng cấu hình có thể ghi đè.

export interface TextPrice {
  inPerM: number;
  cachedPerM: number;
  outPerM: number;
  /** Từ ngưỡng này (token đầu vào), giá của toàn bộ request nhân đôi. */
  cliffTokens: number;
  context: number;
}

export const TEXT_PRICES: Record<string, TextPrice> = {
  'grok-4.7': { inPerM: 2.0, cachedPerM: 0.5, outPerM: 6.0, cliffTokens: 200_000, context: 500_000 },
  'grok-4.3': { inPerM: 1.25, cachedPerM: 0.2, outPerM: 2.5, cliffTokens: 200_000, context: 1_000_000 },
  'grok-build-0.1': { inPerM: 1.0, cachedPerM: 0.2, outPerM: 2.0, cliffTokens: 200_000, context: 256_000 },
};

export const VIDEO_PRICE_PER_SEC: Record<string, number> = {
  'grok-imagine-video': 0.05,
  'grok-imagine-video-1.5': 0.08,
  'grok-imagine-video-1.5-lite': 0.02,
};

export const TTS_PRICE_PER_M_CHARS = 15;
/** Chưa xác nhận chính thức (E-06): ghi đè bằng cấu hình khi G-7 có hóa đơn thật. */
export const DEFAULT_SEARCH_TOOL_PRICE_PER_1K = 5;

export interface TextUsage {
  inputTokens: number;
  cachedTokens?: number;
  outputTokens: number;
}

export function textCost(model: string, u: TextUsage): number {
  const p = TEXT_PRICES[model];
  if (!p) throw new Error(`Chưa có giá cho mô hình ${model}`);
  const mult = u.inputTokens >= p.cliffTokens ? 2 : 1;
  const cached = Math.min(u.cachedTokens ?? 0, u.inputTokens);
  const fresh = u.inputTokens - cached;
  const usd = (fresh * p.inPerM + cached * p.cachedPerM + u.outputTokens * p.outPerM) / 1_000_000;
  return usd * mult;
}

export function videoCost(model: string, seconds: number): number {
  const p = VIDEO_PRICE_PER_SEC[model];
  if (p === undefined) throw new Error(`Chưa có giá cho mô hình video ${model}`);
  return p * seconds;
}

export function ttsCost(chars: number): number {
  return (chars * TTS_PRICE_PER_M_CHARS) / 1_000_000;
}

export function searchToolCost(calls: number, pricePer1k = DEFAULT_SEARCH_TOOL_PRICE_PER_1K): number {
  return (calls * pricePer1k) / 1000;
}

/** FR-GEN-06: chặn trước khi gọi nếu ước lượng token vượt ngưỡng cấu hình. */
export function assertPromptWithinLimit(estimatedInputTokens: number, maxPromptTokens: number): void {
  if (estimatedInputTokens > maxPromptTokens) {
    throw new Error(`Prompt ước lượng ${estimatedInputTokens} token vượt giới hạn ${maxPromptTokens}`);
  }
}
