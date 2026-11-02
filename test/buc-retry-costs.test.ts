import { describe, expect, it } from 'vitest';
import { decidePause, maxUsagePercent, parseBucHeader } from '../src/domain/buc.ts';
import { assertPromptWithinLimit, searchToolCost, textCost, ttsCost, videoCost } from '../src/domain/costs.ts';
import { HttpError, MAX_RETRIES, backoffMs, withRetry } from '../src/domain/retry.ts';

describe('BUC (FR-PUB-04)', () => {
  const h = JSON.stringify({
    '123': [{ type: 'pages', call_count: 12, total_cputime: 85, total_time: 20, estimated_time_to_regain_access: 0 }],
  });
  it('lấy % cao nhất và tạm dừng khi vượt ngưỡng', () => {
    expect(maxUsagePercent(parseBucHeader(h))).toBe(85);
    expect(decidePause(h, 80, 30)).toEqual({ pause: true, percent: 85, minutes: 30 });
  });
  it('không dừng khi thấp', () => {
    const low = JSON.stringify({ '1': [{ call_count: 5, total_cputime: 4, total_time: 3 }] });
    expect(decidePause(low, 80, 30).pause).toBe(false);
  });
  it('dùng thời gian Meta yêu cầu nếu dài hơn mặc định', () => {
    const blocked = JSON.stringify({ '1': [{ call_count: 100, estimated_time_to_regain_access: 45 }] });
    expect(decidePause(blocked, 80, 30).minutes).toBe(45);
  });
  it('chịu được header hỏng hoặc thiếu', () => {
    expect(parseBucHeader('không phải json')).toEqual([]);
    expect(decidePause(undefined, 80, 30).pause).toBe(false);
  });
});

describe('retry (NFR-REL-01)', () => {
  it('backoff 10/20/40 giây khi không nhiễu', () => {
    expect([1, 2, 3].map((k) => backoffMs(k, () => 0))).toEqual([10_000, 20_000, 40_000]);
    expect(() => backoffMs(4)).toThrow();
  });
  it('thử lại lỗi tạm thời rồi thành công', async () => {
    let n = 0;
    const waits: number[] = [];
    const r = await withRetry(
      async () => {
        if (++n < 3) throw new HttpError(503, 'x');
        return 'ok';
      },
      { idempotent: true, sleep: async (ms) => void waits.push(ms), random: () => 0 },
    );
    expect(r).toBe('ok');
    expect(waits).toEqual([10_000, 20_000]);
  });
  it('KHÔNG thử lại khi không idempotent (chống đăng trùng)', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new HttpError(503, 'x');
        },
        { idempotent: false, sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });
  it('không thử lại lỗi không tạm thời (401)', async () => {
    let n = 0;
    await expect(
      withRetry(
        async () => {
          n++;
          throw new HttpError(401, 'x');
        },
        { idempotent: true, sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(n).toBe(1);
  });
  it('dừng sau số lần tối đa và tôn trọng Retry-After', async () => {
    let n = 0;
    const waits: number[] = [];
    await expect(
      withRetry(
        async () => {
          n++;
          throw new HttpError(429, 'x', 7);
        },
        { idempotent: true, sleep: async (ms) => void waits.push(ms) },
      ),
    ).rejects.toThrow();
    expect(n).toBe(MAX_RETRIES + 1);
    expect(waits).toEqual([7000, 7000, 7000]);
  });
});

describe('chi phí (E-01)', () => {
  it('khớp tính tay: 1M vào + 1M ra', () => {
    expect(textCost('grok-4.7', { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(16.0);
    expect(textCost('grok-4.3', { inputTokens: 100_000, outputTokens: 100_000 })).toBeCloseTo(0.375);
  });
  it('tính cached riêng', () => {
    expect(textCost('grok-4.7', { inputTokens: 100_000, cachedTokens: 60_000, outputTokens: 0 })).toBeCloseTo(0.04 * 2 + 0.06 * 0.5);
  });
  it('nhân đôi toàn bộ từ ngưỡng 200K', () => {
    expect(textCost('grok-4.7', { inputTokens: 200_000, outputTokens: 0 })).toBeCloseTo(0.4 * 2);
  });
  it('video, TTS, công cụ tìm kiếm', () => {
    expect(videoCost('grok-imagine-video-1.5-lite', 225)).toBeCloseTo(4.5);
    expect(ttsCost(300_000)).toBeCloseTo(4.5);
    expect(searchToolCost(1000)).toBe(5);
  });
  it('lỗi với mô hình chưa có giá', () => {
    expect(() => textCost('grok-9', { inputTokens: 1, outputTokens: 1 })).toThrow();
  });
  it('chặn prompt quá lớn', () => {
    expect(() => assertPromptWithinLimit(150_001, 150_000)).toThrow();
    expect(() => assertPromptWithinLimit(150_000, 150_000)).not.toThrow();
  });
});
