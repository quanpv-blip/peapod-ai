import { describe, expect, it } from 'vitest';
import { isReelStale, reelEtaText, reelErrorText, reelPct, reelStageText, reelView, REEL_STALE_MS, type ReelStatus } from '../src/domain/reel.ts';

const now = new Date('2026-11-05T10:00:00Z');
const pending = (over: Partial<ReelStatus> = {}): ReelStatus => ({ state: 'pending', at: now.toISOString(), stage: 'rendering', progress: 0.5, frames: 225, totalFrames: 450, etaSeconds: 10, ...over });

describe('tiến độ dựng video', () => {
  it('phần trăm được giới hạn 0..100 và làm tròn', () => {
    expect(reelPct({ progress: 0.456 })).toBe(46);
    expect(reelPct({ progress: 1.7 })).toBe(100);
    expect(reelPct({ progress: -1 })).toBe(0);
    expect(reelPct({})).toBe(0);
  });

  it('mô tả giai đoạn: chờ, dựng khung hình có số khung, hoàn tất', () => {
    expect(reelStageText(pending({ stage: 'queued' }))).toBe('Đang chờ đến lượt dựng');
    expect(reelStageText(pending({ stage: 'rendering', frames: 225, totalFrames: 450 }))).toBe('Đang dựng khung hình 225/450');
    expect(reelStageText(pending({ stage: 'finalizing' }))).toBe('Đang hoàn tất file MP4');
  });

  it('thời gian còn lại: chưa đủ dữ liệu, giây, phút và giây, sắp xong', () => {
    expect(reelEtaText(pending({ etaSeconds: null }))).toBe('đang tính thời gian còn lại');
    expect(reelEtaText(pending({ etaSeconds: 12 }))).toBe('còn khoảng 12 giây');
    expect(reelEtaText(pending({ etaSeconds: 125 }))).toBe('còn khoảng 2 phút 5 giây');
    expect(reelEtaText(pending({ etaSeconds: 1 }))).toBe('sắp xong');
  });

  it('mã lỗi kỹ thuật được đổi thành câu tiếng Việt', () => {
    expect(reelErrorText('render_failed')).toContain('Dịch vụ render gặp lỗi');
    expect(reelErrorText('Câu đã dễ hiểu')).toBe('Câu đã dễ hiểu');
    expect(reelErrorText(null)).toBe('Lỗi không xác định khi dựng video.');
  });
});

describe('gián đoạn và dữ liệu cho giao diện', () => {
  it('việc đang chạy mà không cập nhật quá ngưỡng thì là gián đoạn; việc vừa cập nhật thì không', () => {
    const old = new Date(now.getTime() - REEL_STALE_MS - 1000).toISOString();
    expect(isReelStale(pending({ at: old }), now)).toBe(true);
    expect(isReelStale(pending(), now)).toBe(false);
    expect(isReelStale({ state: 'ready', at: old }, now)).toBe(false);
  });

  it('reelView: không có trạng thái thì state = none; đang dựng có chữ và giờ; lỗi có thông điệp; sẵn sàng 100%', () => {
    expect(reelView(null, false)).toMatchObject({ state: 'none', hasVideo: false });
    expect(reelView(pending(), false)).toMatchObject({ state: 'pending', pct: 50, stageText: 'Đang dựng khung hình 225/450', etaText: 'còn khoảng 10 giây', error: null });
    expect(reelView({ state: 'error', at: now.toISOString(), error: 'Lỗi A' }, true)).toMatchObject({ state: 'error', error: 'Lỗi A', hasVideo: true, stageText: '' });
    expect(reelView({ state: 'ready', at: now.toISOString(), progress: 1 }, true)).toMatchObject({ state: 'ready', pct: 100 });
  });
});

describe('chờ khi AI quá tải', () => {
  it('thanh tiến độ hiện lý do chờ thay cho tên bước', () => {
    expect(reelStageText({ state: 'pending', at: 'x', stage: 'directing', waiting: 'Gemini đang quá tải, tự thử lại sau 20 giây (lần 1/3)' })).toMatch(/quá tải/);
    expect(reelStageText({ state: 'pending', at: 'x', stage: 'directing' })).toBe('AI đang viết kịch bản phân cảnh');
    expect(reelStageText({ state: 'pending', at: 'x', stage: 'voicing' })).toBe('Đang tạo giọng đọc');
  });
});
