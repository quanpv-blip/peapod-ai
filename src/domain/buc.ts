// FR-PUB-04: đọc header x-business-use-case-usage của Meta và quyết định tạm dừng hàng đợi đăng.
// Cấu trúc header: {"<id>":[{"type":"pages","call_count":N,"total_cputime":N,"total_time":N,"estimated_time_to_regain_access":phút}]}

export interface BucEntry {
  type?: string;
  call_count?: number;
  total_cputime?: number;
  total_time?: number;
  estimated_time_to_regain_access?: number;
}

export function parseBucHeader(header: string | null | undefined): BucEntry[] {
  if (!header) return [];
  try {
    const obj = JSON.parse(header) as Record<string, BucEntry[]>;
    return Object.values(obj).flat();
  } catch {
    return [];
  }
}

/** Phần trăm sử dụng cao nhất trong ba chỉ số. */
export function maxUsagePercent(entries: BucEntry[]): number {
  let max = 0;
  for (const e of entries) {
    max = Math.max(max, e.call_count ?? 0, e.total_cputime ?? 0, e.total_time ?? 0);
  }
  return max;
}

export interface PauseDecision {
  pause: boolean;
  percent: number;
  /** Phút nên chờ: lớn hơn giữa mặc định cấu hình và thời gian Meta yêu cầu. */
  minutes: number;
}

export function decidePause(header: string | null | undefined, thresholdPercent: number, defaultMinutes: number): PauseDecision {
  const entries = parseBucHeader(header);
  const percent = maxUsagePercent(entries);
  const regain = Math.max(0, ...entries.map((e) => e.estimated_time_to_regain_access ?? 0));
  const pause = percent >= thresholdPercent || regain > 0;
  return { pause, percent, minutes: pause ? Math.max(defaultMinutes, regain) : 0 };
}
