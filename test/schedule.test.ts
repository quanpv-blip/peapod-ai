import { describe, expect, it } from 'vitest';
import { checkScheduleWindow, nextBusinessSlot, nextLocalSlot } from '../src/domain/schedule.ts';

describe('giờ đăng (FR-REV-06)', () => {
  const now = new Date('2026-11-02T01:00:00Z'); // Thứ Hai 08:00 ICT / 10:00 JST
  it('VN 11:30 ICT hôm nay = 04:30Z', () => {
    expect(nextLocalSlot('VN', '11:30', now).toISOString()).toBe('2026-11-02T04:30:00.000Z');
  });
  it('JP 12:00 JST hôm nay = 03:00Z', () => {
    expect(nextLocalSlot('JP', '12:00', now).toISOString()).toBe('2026-11-02T03:00:00.000Z');
  });
  it('quá giờ thì sang ngày mai', () => {
    const late = new Date('2026-11-02T05:00:00Z');
    expect(nextLocalSlot('VN', '11:30', late).toISOString()).toBe('2026-11-03T04:30:00.000Z');
  });
  it('giữ lề 15 phút', () => {
    const near = new Date('2026-11-02T04:20:00Z');
    expect(nextLocalSlot('VN', '11:30', near).toISOString()).toBe('2026-11-03T04:30:00.000Z');
  });
  it('bỏ qua cuối tuần', () => {
    const fri = new Date('2026-11-06T06:00:00Z'); // Thứ Sáu 13:00 ICT, đã quá 11:30
    expect(nextBusinessSlot('VN', '11:30', fri).toISOString()).toBe('2026-11-09T04:30:00.000Z');
  });
  it('xử lý ranh giới ngày JST', () => {
    const t = new Date('2026-11-02T16:00:00Z'); // 01:00 JST ngày 3
    expect(nextLocalSlot('JP', '12:00', t).toISOString()).toBe('2026-11-03T03:00:00.000Z');
  });
  it('kiểm tra cửa sổ Meta', () => {
    expect(checkScheduleWindow(new Date(now.getTime() + 10 * 60_000), now)).toEqual({ ok: false, reason: 'TOO_SOON' });
    expect(checkScheduleWindow(new Date(now.getTime() + 20 * 60_000), now)).toEqual({ ok: true });
    expect(checkScheduleWindow(new Date(now.getTime() + 29 * 86_400_000), now)).toEqual({ ok: false, reason: 'TOO_FAR' });
  });
  it('từ chối giờ sai định dạng', () => {
    expect(() => nextLocalSlot('VN', '25:00', now)).toThrow();
    expect(() => nextLocalSlot('VN', '9:00', now)).toThrow();
  });
});
