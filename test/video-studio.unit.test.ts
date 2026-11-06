import { describe, expect, it } from 'vitest';
import { videoView, type VideoRowInfo } from '../src/web/views/video.ts';
import { studioView } from '../src/web/views/studio.ts';
import type { ContentRow } from '../src/services/contents.ts';
import { pageInfo } from '../src/domain/paging.ts';

const row = (id: number, market: 'VN' | 'JP' = 'VN'): ContentRow =>
  ({ id, market, format: 'POST', media_engine: 'NONE', state: 'APPROVED', current_revision: 2, scheduled_at: null, updated_at: new Date().toISOString() }) as unknown as ContentRow;

const base = { ctx: { user: { name: 'Quản trị', email: 'a@x', roles: ['admin'] }, csrf: 'tok' }, rows: [row(7)], filter: { state: '', market: '' }, page: pageInfo(1, 1), markets: ['VN', 'JP'] };

describe('trang Video 9:16', () => {
  it('bài chưa dựng: có nút "Dựng video" gửi kèm back=video và CSRF', () => {
    const info = new Map<string, VideoRowInfo>([['7', { headline: 'Tin A', built: false, builtRevision: null, reel: null }]]);
    const out = videoView({ ...base, info, reelOn: true, canBuild: () => true });
    expect(out).toContain('action="/contents/7/reel"');
    expect(out).toContain('name="back" value="video"');
    expect(out).toContain('name="_csrf" value="tok"');
    expect(out).toContain('Dựng video');
    expect(out).toContain('Chưa dựng');
  });

  it('đã có video đúng bản: hiện Xem/Tải MP4 và nút Dựng lại', () => {
    const info = new Map<string, VideoRowInfo>([['7', { headline: 'Tin A', built: true, builtRevision: null, reel: { state: 'ready', at: 'x' } }]]);
    const out = videoView({ ...base, info, reelOn: true, canBuild: () => true });
    expect(out).toContain('href="/contents/7/reel" download');
    expect(out).toContain('Dựng lại');
  });

  it('đang dựng: không có nút dựng, có thanh tiến độ, nút hủy; tự cập nhật tại chỗ, KHÔNG tải lại cả trang theo nhịp', () => {
    const reel = { state: 'pending' as const, at: new Date().toISOString(), stage: 'rendering' as const, progress: 0.45, frames: 200, totalFrames: 450, etaSeconds: 9 };
    const info = new Map<string, VideoRowInfo>([['7', { headline: 'Tin A', built: false, builtRevision: null, reel }]]);
    const out = videoView({ ...base, info, reelOn: true, canBuild: () => true });
    expect(out).not.toContain('action="/contents/7/reel" data-reel-form');
    expect(out).toContain('<progress class="reel-bar"');
    expect(out).toContain('value="45"');
    expect(out).toContain('Đang dựng khung hình 200/450');
    expect(out).toContain('còn khoảng 9 giây');
    expect(out).toContain('action="/contents/7/reel/cancel"');
    expect(out).toContain('data-reel-poll="/contents/7/reel/status"');
    expect(out).not.toContain('data-reel-refresh');
  });

  it('lỗi: hiện lý do và nút dựng lại; không tự tải lại trang', () => {
    const info = new Map<string, VideoRowInfo>([['7', { headline: 'Tin A', built: false, builtRevision: null, reel: { state: 'error', at: 'x', error: 'Dịch vụ render gặp lỗi' } }]]);
    const out = videoView({ ...base, info, reelOn: true, canBuild: () => true });
    expect(out).toContain('Dựng video lỗi: Dịch vụ render gặp lỗi');
    expect(out).toContain('action="/contents/7/reel"');
    expect(out).not.toContain('data-reel-refresh');
  });

  it('người chỉ xem (không có quyền thị trường) không thấy nút dựng', () => {
    const info = new Map<string, VideoRowInfo>([['7', { headline: 'Tin A', built: false, builtRevision: null, reel: null }]]);
    const out = videoView({ ...base, info, reelOn: true, canBuild: () => false });
    expect(out).not.toContain('action="/contents/7/reel"');
    expect(out).toContain('Chỉ xem');
  });

  it('chưa cấu hình Remotion thì báo rõ và vô hiệu hóa nút', () => {
    const info = new Map<string, VideoRowInfo>([['7', { headline: 'Tin A', built: false, builtRevision: null, reel: null }]]);
    const out = videoView({ ...base, info, reelOn: false, canBuild: () => true });
    expect(out).toContain('REMOTION_RENDER_URL');
    expect(out).toContain('Chưa bật dịch vụ');
    expect(out).not.toContain('action="/contents/7/reel"');
  });
});

describe('tab Biên tập video (Remotion Studio)', () => {
  it('có URL: nhúng iframe tới đúng địa chỉ', () => {
    const out = studioView({ ctx: base.ctx, studioUrl: 'http://192.168.1.145:3000/' });
    expect(out).toContain('<iframe class="studio-frame" src="http://192.168.1.145:3000/"');
  });

  it('chưa có URL: không có iframe, có hướng dẫn cấu hình', () => {
    const out = studioView({ ctx: base.ctx, studioUrl: null });
    expect(out).not.toContain('<iframe');
    expect(out).toContain('REMOTION_STUDIO_URL');
  });
});
