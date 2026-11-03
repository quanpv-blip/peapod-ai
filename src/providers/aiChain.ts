// Chuỗi mô hình dự phòng cho Gemini. Thử lần lượt từng mô hình; hết hạn mức, quá tải hay quá chậm thì sang mô hình kế tiếp.
// Lỗi cuối cùng được gom thành lý do dễ hiểu để hiển thị cho người dùng (không lộ khóa API).
import type { GeminiClient } from './gemini.ts';

export class AiUnavailableError extends Error {
  constructor(readonly reasons: string[]) {
    super(`AI tạm không trả lời được (${reasons.join('; ')})`);
    this.name = 'AiUnavailableError';
  }
}

/** Phân loại lỗi gọi AI thành nhãn tiếng Việt ngắn gọn. */
export function classifyAiError(e: unknown): string {
  const err = e as Error & { status?: number };
  const msg = err?.message ?? '';
  if (err?.status === 429 || /HTTP 429|Rate limit|quota|RESOURCE_EXHAUSTED/i.test(msg)) return 'hết hạn mức trong ngày';
  if (err?.status === 503 || /HTTP 503|high demand|quá tải|UNAVAILABLE/i.test(msg)) return 'đang quá tải';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || /aborted|timed? ?out/i.test(msg)) return 'phản hồi quá chậm';
  return 'lỗi';
}

/** Bọc một GeminiClient bằng chuỗi mô hình. `args.model` bị bỏ qua: chuỗi quyết định mô hình nào được dùng. */
export interface FallbackHooks {
  /** Gọi khi một mô hình báo hết hạn mức (429): dùng để ghi nhận hạn mức trong ngày. */
  onExhausted?: (model: string) => Promise<void> | void;
}

export function withFallback(inner: GeminiClient, models: string[], hooks: FallbackHooks = {}): GeminiClient {
  const chain = [...new Set(models.map((m) => m.trim()).filter(Boolean))];
  if (chain.length === 0) throw new Error('Chuỗi mô hình Gemini rỗng');
  return {
    async generateJson(args) {
      const reasons: string[] = [];
      for (const model of chain) {
        try {
          return await inner.generateJson({ ...args, model });
        } catch (e) {
          const label = classifyAiError(e);
          if (label === 'hết hạn mức trong ngày') await hooks.onExhausted?.(model);
          reasons.push(`${model}: ${label}`);
        }
      }
      throw new AiUnavailableError(reasons);
    },
    tts: inner.tts,
  };
}

/** Danh sách mô hình từ biến môi trường GEMINI_MODELS (phân tách bằng dấu phẩy). Mặc định: 3.6 rồi 3.5 (3.5 ổn định hơn khi 3.6 hết hạn mức). */
export function modelChainFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env.GEMINI_MODELS ?? 'gemini-3.6-flash,gemini-3.5-flash';
  return raw.split(',').map((m) => m.trim()).filter(Boolean);
}
