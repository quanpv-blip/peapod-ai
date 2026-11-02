import { HttpError, withRetry } from '../domain/retry.ts';

export interface JsonResponse<T = unknown> {
  status: number;
  json: T;
  headers: Headers;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  /** Chỉ true cho thao tác an toàn khi lặp lại (đọc, hoặc đã đối soát). Mặc định false (docs/04 mục 3.7). */
  idempotent?: boolean;
  timeoutMs?: number;
}

/** Gọi HTTP trả JSON; ném HttpError cho mã không thành công. Không bao giờ ghi header Authorization vào thông báo lỗi. */
export async function requestJson<T = unknown>(url: string, opts: RequestOptions = {}): Promise<JsonResponse<T>> {
  const run = async (): Promise<JsonResponse<T>> => {
    const res = await fetch(url, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    if (!res.ok) {
      const retryAfter = Number(res.headers.get('retry-after'));
      throw new HttpError(res.status, `HTTP ${res.status} ${new URL(url).pathname}: ${text.slice(0, 300)}`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
    }
    return { status: res.status, json: json as T, headers: res.headers };
  };
  return withRetry(run, { idempotent: opts.idempotent ?? false });
}
