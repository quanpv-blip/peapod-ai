import { describe, expect, it } from 'vitest';
import type { ContentPackage } from '../src/domain/package.ts';
import { bulkApprovable, scoreQuality } from '../src/domain/quality.ts';
import { planSlots } from '../src/domain/bulk.ts';
import { GenJobs } from '../src/services/genJobs.ts';
import type { GenerateResult } from '../src/services/generate.ts';
import { queueView, type RowInfo } from '../src/web/views/queue.ts';
import { pageInfo } from '../src/domain/paging.ts';
import type { ContentRow } from '../src/services/contents.ts';

export const GOOD_BODY = `Một nền tảng dữ liệu mới hứa hẹn gom báo cáo bán hàng và vận hành về một màn hình duy nhất.

📌 Điều gì đang diễn ra: Công ty A vừa công bố nền tảng dữ liệu dành cho doanh nghiệp vừa và nhỏ, cho phép hợp nhất dữ liệu bán hàng và vận hành trong một bảng điều khiển, bắt đầu cung cấp từ quý tới.

Điểm chính:
▸ Tích hợp nhanh với các phần mềm kế toán phổ biến trên thị trường.
▸ Báo cáo cập nhật theo thời gian thực cho từng chi nhánh.
▸ Phân quyền truy cập theo vai trò, có nhật ký thao tác đầy đủ.

💡 Góc nhìn của chúng tôi: Với doanh nghiệp nhiều chi nhánh, dữ liệu rời rạc là nguyên nhân chính khiến báo cáo đến muộn. Có thể thử với một chi nhánh trước và đo thời gian ra báo cáo trước và sau khi dùng.

🔗 Nguồn: VnExpress`;

const pkg = (over: Partial<ContentPackage['post']> = {}, extra: Partial<ContentPackage> = {}): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline: 'Công ty A ra mắt nền tảng dữ liệu mới', body: GOOD_BODY, call_to_action: 'Báo cáo của bạn đang mất bao lâu để hoàn thành mỗi tuần?', hashtags: ['#DuLieu', '#ChuyenDoiSo', '#SME'], ...over },
  sources: [{ title: 'VnExpress', url: 'https://vnexpress.net/a' }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
  ...extra,
});

describe('chấm chất lượng bản nháp', () => {
  it('bài đúng cấu trúc, đủ độ dài, có nguồn: điểm tốt và đủ điều kiện duyệt hàng loạt', () => {
    const q = scoreQuality(pkg(), 'VN');
    expect(q.grade).toBe('good');
    expect(q.score).toBeGreaterThanOrEqual(85);
    expect(bulkApprovable(q, 0)).toBe(true);
  });

  it('thiếu mục cấu trúc và quá ngắn: bị trừ điểm, không đủ điều kiện duyệt hàng loạt', () => {
    const q = scoreQuality(pkg({ body: 'Ngắn quá.' }), 'VN');
    expect(q.issues.map((i) => i.text).join('|')).toContain('Thiếu mục "Điểm chính"');
    expect(q.score).toBeLessThan(85);
    expect(bulkApprovable(q, 0)).toBe(false);
  });

  it('từ bị cấm là lỗi nặng, chặn duyệt hàng loạt dù điểm cao', () => {
    const q = scoreQuality(pkg({ body: `${GOOD_BODY} Đây là giải pháp tốt nhất.` }), 'VN');
    expect(q.issues.some((i) => i.level === 'bad' && i.text.includes('tốt nhất'))).toBe(true);
    expect(bulkApprovable(q, 0, 0)).toBe(false);
  });

  it('có khẳng định cần kiểm: trừ điểm và không duyệt hàng loạt', () => {
    const q = scoreQuality(pkg({}, { claims_to_verify: ['Doanh thu tăng 30%'] }), 'VN');
    expect(q.issues.some((i) => i.text.includes('khẳng định'))).toBe(true);
    expect(bulkApprovable(q, 1)).toBe(false);
  });

  it('không có nguồn: lỗi nặng', () => {
    const q = scoreQuality(pkg({}, { sources: [] }), 'VN');
    expect(q.issues.some((i) => i.level === 'bad')).toBe(true);
  });
});

describe('chia giờ đăng hàng loạt', () => {
  const now = new Date('2026-11-05T03:00:00Z'); // 10:00 ICT, thứ Năm

  it('mỗi bài một ngày làm việc, bỏ cuối tuần, tăng dần', () => {
    const slots = planSlots('VN', '11:30', 3, [], now);
    expect(slots).toHaveLength(3);
    expect(slots[0]!.toISOString()).toBe('2026-11-05T04:30:00.000Z');
    expect(slots[1]!.toISOString()).toBe('2026-11-06T04:30:00.000Z');
    expect(slots[2]!.toISOString()).toBe('2026-11-09T04:30:00.000Z');
  });

  it('bỏ giờ đã có bài', () => {
    const taken = [new Date('2026-11-05T04:30:00Z').getTime()];
    const slots = planSlots('VN', '11:30', 2, taken, now);
    expect(slots[0]!.toISOString()).toBe('2026-11-06T04:30:00.000Z');
    expect(slots).toHaveLength(2);
  });

  it('không vượt quá hạn 29 ngày của Meta', () => {
    const slots = planSlots('VN', '11:30', 60, [], now);
    expect(slots.length).toBeLessThan(60);
    expect(slots.length).toBeGreaterThan(10);
  });
});

describe('việc tạo bản tin chạy nền', () => {
  const res = (o: Partial<GenerateResult> = {}): GenerateResult => ({ title: 'x', outcome: 'created', detail: 'bài #1', ...o });
  const tick = () => new Promise((r) => setTimeout(r, 10));

  it('ghi tiến độ, chặn bấm chồng cùng thị trường, cho phép thị trường khác', async () => {
    const jobs = new GenJobs();
    let finish!: (r: GenerateResult[]) => void;
    const j = jobs.start('VN', 'a@x', 2, (onProgress) => new Promise<GenerateResult[]>((resolve) => {
      onProgress(res(), 1);
      finish = resolve;
    }));
    expect(j).not.toBeNull();
    expect(jobs.start('VN', 'b@x', 1, async () => [])).toBeNull();
    expect(jobs.start('JP', 'b@x', 1, async () => [res()])).not.toBeNull();
    const view = jobs.recent(['VN'])[0]!;
    expect(view).toMatchObject({ state: 'running', made: 1, target: 2, pct: 50 });
    expect(view.text).toContain('1/2');
    finish([res(), res()]);
    await tick();
    const done = jobs.recent(['VN'])[0]!;
    expect(done).toMatchObject({ state: 'done', made: 2, pct: 100 });
    expect(jobs.start('VN', 'a@x', 1, async () => [])).not.toBeNull();
  });

  it('lỗi bất ngờ được ghi vào việc, không làm sập và không chặn mãi', async () => {
    const jobs = new GenJobs();
    jobs.start('VN', 'a@x', 1, async () => { throw new Error('mạng đứt'); });
    await tick();
    const v = jobs.recent(['VN'])[0]!;
    expect(v.state).toBe('error');
    expect(v.text).toContain('mạng đứt');
    expect(jobs.running('VN')).toBeNull();
  });

  it('mục bị bỏ qua được ghi lý do; chỉ thấy việc của thị trường mình được xem', async () => {
    const jobs = new GenJobs();
    jobs.start('VN', 'a@x', 1, async (onProgress) => {
      onProgress(res({ outcome: 'skipped', detail: 'sai ngôn ngữ', title: 'Tin B' }), 0);
      return [res({ outcome: 'skipped', detail: 'sai ngôn ngữ', title: 'Tin B' })];
    });
    await tick();
    expect(jobs.recent(['JP'])).toHaveLength(0);
    const v = jobs.recent(['VN'])[0]!;
    expect(v.reasons[0]).toContain('sai ngôn ngữ');
    expect(v.skipped).toBe(1);
  });

  it('việc chạy quá lâu bị coi là hỏng để không chặn mãi', () => {
    let t = 1_000;
    const jobs = new GenJobs(() => t);
    jobs.start('VN', 'a@x', 1, () => new Promise(() => undefined));
    expect(jobs.running('VN')).not.toBeNull();
    t += 11 * 60_000;
    expect(jobs.running('VN')).toBeNull();
  });
});

describe('hàng chờ: duyệt hàng loạt và chất lượng', () => {
  const row = (id: number, state = 'IN_REVIEW'): ContentRow => ({ id, market: 'VN', format: 'TEXT', media_engine: 'NONE', state, current_revision: 1, scheduled_at: null, updated_at: new Date().toISOString() }) as unknown as ContentRow;
  const q = scoreQuality(pkg(), 'VN');
  const info = new Map<string, RowInfo>([
    ['1', { headline: 'A', claims: 0, sources: 1, editedBy: null, quality: q, bulkOk: true }],
    ['2', { headline: 'B', claims: 2, sources: 1, editedBy: null, quality: scoreQuality(pkg({ body: 'x' }), 'VN'), bulkOk: false }],
  ]);
  const base = { ctx: { user: { name: 'Q', email: 'a@x', roles: ['approver_vn'] }, csrf: 'tok' }, rows: [row(1), row(2), row(3, 'APPROVED')], info, counts: { IN_REVIEW: 2 }, filter: { state: '', market: '', q: '' }, page: pageInfo(1, 3), markets: ['VN'], now: new Date(), canGenerate: true, canPublish: false, genJobs: [] };

  it('có checkbox cho bài chờ duyệt (không cho bài đã duyệt), form gửi tới /queue/bulk, có cột chất lượng', () => {
    const out = queueView({ ...base, canBulk: true });
    expect(out).toContain('action="/queue/bulk"');
    expect(out).toContain('name="ids" value="1" data-ok="1"');
    expect(out).toContain('name="ids" value="2" data-ok="0"');
    expect(out).not.toContain('name="ids" value="3"');
    expect(out).toContain('Chất lượng');
    expect(out).toContain('name="_csrf" value="tok"');
  });

  it('người không có quyền duyệt không thấy ô chọn và nút hàng loạt', () => {
    const out = queueView({ ...base, canBulk: false });
    expect(out).not.toContain('name="ids"');
    expect(out).not.toContain('/queue/bulk');
  });

  it('đang tạo bản tin: hiện thanh tiến độ, nút tạo bị khóa', () => {
    const out = queueView({ ...base, canBulk: true, genJobs: [{ id: 'j', market: 'VN', state: 'running', target: 3, made: 1, skipped: 0, failed: 0, pct: 33, text: 'Đang tạo bản tin VN: 1/3 bài', elapsedSec: 5, reasons: [] }] });
    expect(out).toContain('data-gen-poll="/queue/generate/status"');
    expect(out).toContain('<progress class="reel-bar" data-gen-bar max="100" value="33">');
    expect(out).toContain('Đang tạo…');
  });
});
