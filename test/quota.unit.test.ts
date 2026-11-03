import { describe, expect, it } from 'vitest';
import { creditRemaining, dailyLimitState, metaPostState, nextPacificMidnight } from '../src/domain/quota.ts';

describe('dailyLimitState', () => {
  it('coi là hết khi đã có lỗi 429 trong ngày, bất kể số đếm', () => {
    expect(dailyLimitState(3, 20, true).state).toBe('het');
  });
  it('không có giới hạn cấu hình thì báo chưa rõ', () => {
    expect(dailyLimitState(3, 0, false).state).toBe('chua-ro');
  });
  it('còn nhiều thì báo còn và hiện số còn lại', () => {
    const v = dailyLimitState(5, 20, false);
    expect(v.state).toBe('con');
    expect(v.label).toBe('Còn 15/20');
    expect(v.pct).toBe(25);
  });
  it('từ 80% trở lên là sắp hết', () => {
    expect(dailyLimitState(17, 20, false).state).toBe('sap-het');
  });
  it('dùng đủ giới hạn là hết', () => {
    expect(dailyLimitState(20, 20, false).state).toBe('het');
  });
  it('dùng vượt giới hạn vẫn không quá 100%', () => {
    expect(dailyLimitState(25, 20, false).pct).toBe(100);
  });
});

describe('creditRemaining', () => {
  it('chưa nhập số dư thì báo chưa rõ', () => {
    expect(creditRemaining(0, 0).state).toBe('chua-ro');
  });
  it('chi phí bằng hoặc vượt số dư là hết', () => {
    expect(creditRemaining(5, 5).state).toBe('het');
    expect(creditRemaining(5, 9).remainingUsd).toBe(0);
  });
  it('còn dưới 20% số dư ban đầu là sắp hết', () => {
    const v = creditRemaining(10, 8.5);
    expect(v.state).toBe('sap-het');
    expect(v.remainingUsd).toBeCloseTo(1.5);
  });
  it('còn nhiều thì báo còn', () => {
    expect(creditRemaining(10, 2).state).toBe('con');
  });
});

describe('metaPostState', () => {
  it('dưới giới hạn là còn', () => {
    expect(metaPostState(3).state).toBe('con');
  });
  it('từ 24/30 bài trở lên là sắp chạm giới hạn', () => {
    expect(metaPostState(25).state).toBe('sap-het');
  });
  it('đủ 30 bài là hết', () => {
    const v = metaPostState(30);
    expect(v.state).toBe('het');
    expect(v.pct).toBe(100);
  });
});

describe('nextPacificMidnight', () => {
  it('giờ đông (PST, UTC-8): nửa đêm kế tiếp là 08:00 UTC', () => {
    expect(nextPacificMidnight(new Date('2026-01-15T12:00:00Z')).toISOString()).toBe('2026-01-16T08:00:00.000Z');
  });
  it('giờ hè (PDT, UTC-7): nửa đêm kế tiếp là 07:00 UTC', () => {
    expect(nextPacificMidnight(new Date('2026-07-15T12:00:00Z')).toISOString()).toBe('2026-07-16T07:00:00.000Z');
  });
  it('luôn lớn hơn thời điểm hiện tại', () => {
    const now = new Date('2026-03-08T09:30:00Z');
    expect(nextPacificMidnight(now).getTime()).toBeGreaterThan(now.getTime());
  });
});
