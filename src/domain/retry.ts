// NFR-REL-01 và docs/04 mục 2.6: thử lại có lùi mũ cho lỗi tạm thời.
// Công thức: chờ 5 * 2^k giây, k = 1..3 (10 s, 20 s, 40 s), cộng nhiễu ngẫu nhiên tối đa 20%.

export const MAX_RETRIES = 3;
const TRANSIENT_HTTP = new Set([429, 500, 502, 503, 504]);

export function isTransientStatus(status: number): boolean {
  return TRANSIENT_HTTP.has(status);
}

export function backoffMs(attempt: number, random: () => number = Math.random): number {
  if (attempt < 1 || attempt > MAX_RETRIES) throw new RangeError(`attempt phải trong 1..${MAX_RETRIES}`);
  const base = 5_000 * 2 ** attempt;
  return Math.round(base * (1 + random() * 0.2));
}

export interface RetryOptions {
  /** Thao tác tạo tài nguyên (đăng bài, tạo video AI) KHÔNG được thử lại tự động trừ khi đã đối soát. */
  idempotent: boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const transient = e instanceof HttpError ? isTransientStatus(e.status) : true; // lỗi mạng coi là tạm thời
      if (!opts.idempotent || !transient || attempt >= MAX_RETRIES) throw e;
      const wait = e instanceof HttpError && e.retryAfterSec ? e.retryAfterSec * 1000 : backoffMs(attempt + 1, opts.random);
      await sleep(wait);
    }
  }
}
