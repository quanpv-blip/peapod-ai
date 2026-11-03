// Test tích hợp trên PostgreSQL thật (schema tạm). Bỏ qua nếu không đặt TEST_DATABASE_URL.
// Ví dụ: TEST_DATABASE_URL=postgres://app:<mật khẩu>@127.0.0.1:5433/peapod npm test
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '../src/auth.ts';
import { packageHash, type ContentPackage } from '../src/domain/package.ts';
import * as svc from '../src/services/contents.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;

const vn: Actor = { email: 'vn@t', name: 'VN', roles: ['approver_vn'] };
const jp1: Actor = { email: 'jp1@t', name: 'JP1', roles: ['approver_jp'] };
const jp2: Actor = { email: 'jp2@t', name: 'JP2', roles: ['approver_jp'] };
const admin: Actor = { email: 'ad@t', name: 'Admin', roles: ['admin'] };
const future = (h: number) => new Date(Date.now() + h * 3_600_000);

const pkg = (market: 'VN' | 'JP', claims: string[] = ['Một khẳng định']): ContentPackage => ({
  market,
  topic_summary: 'tóm tắt',
  post: market === 'JP'
    ? { headline: '見出し', body: 'これは日本語の本文です。システム開発のご相談はお気軽にどうぞ。', call_to_action: 'お問い合わせください', hashtags: ['#DX'] }
    : { headline: 'Tiêu đề', body: 'Đây là nội dung tiếng Việt về chuyển đổi số cho doanh nghiệp.', call_to_action: 'Liên hệ ngay', hashtags: ['#DX'] },
  sources: [{ title: 'Nguồn', url: 'https://example.com/a' }],
  claims_to_verify: claims,
  media: { engine: 'NONE' },
});

d('dịch vụ duyệt bài (PostgreSQL thật)', () => {
  const schema = `t_${randomBytes(4).toString('hex')}`;
  let admin_: pg.Pool;
  let db: pg.Pool;

  async function seed(market: 'VN' | 'JP', p = pkg(market), editedBy: string | null = null): Promise<number> {
    const it = await db.query('INSERT INTO content_item(market, page_key, format, media_engine, state) VALUES ($1,$1,$2,$3,$4) RETURNING id', [market, 'TEXT', 'NONE', 'IN_REVIEW']);
    const id = Number(it.rows[0].id);
    await db.query('INSERT INTO content_revision(content_id, revision, package, package_hash, edited_by) VALUES ($1,1,$2,$3,$4)', [id, JSON.stringify(p), packageHash(p), editedBy]);
    return id;
  }
  const rev = async (id: number) => (await svc.getContent(db, admin, id));

  beforeAll(async () => {
    admin_ = new pg.Pool({ connectionString: URL_ });
    await admin_.query(`CREATE SCHEMA ${schema}`);
    db = new pg.Pool({ connectionString: URL_, options: `-c search_path=${schema}` });
    for (const f of ['001_init.sql', '002_users.sql']) await db.query(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'));
  });
  afterAll(async () => {
    await db?.end();
    await admin_?.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin_?.end();
  });

  it('người duyệt VN không thấy và không duyệt được bài JP', async () => {
    const id = await seed('JP');
    expect((await svc.listContents(db, vn)).some((r) => Number(r.id) === id)).toBe(false);
    await expect(svc.getContent(db, vn, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const h = packageHash(pkg('JP'));
    await expect(svc.approve(db, vn, id, { revision: 1, packageHash: h, scheduledAt: future(48), claimsConfirmed: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('admin xem được nhưng không duyệt thay', async () => {
    const id = await seed('VN');
    expect((await svc.getContent(db, admin, id)).item.market).toBe('VN');
    await expect(svc.approve(db, admin, id, { revision: 1, packageHash: packageHash(pkg('VN')), scheduledAt: future(48), claimsConfirmed: true })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('duyệt thành công, ghi nhật ký, rồi không duyệt lại được', async () => {
    const id = await seed('VN');
    const h = packageHash(pkg('VN'));
    await svc.approve(db, vn, id, { revision: 1, packageHash: h, scheduledAt: future(48), claimsConfirmed: true });
    const d1 = await rev(id);
    expect(d1.item.state).toBe('APPROVED');
    expect(d1.events[0]).toMatchObject({ action: 'APPROVE', actor: 'vn@t', revision: 1 });
    await expect(svc.approve(db, vn, id, { revision: 1, packageHash: h, scheduledAt: future(48), claimsConfirmed: true })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('duyệt gắn với hash đã thấy: hash sai bị chặn', async () => {
    const id = await seed('VN');
    await expect(svc.approve(db, vn, id, { revision: 1, packageHash: 'deadbeef', scheduledAt: future(48), claimsConfirmed: true })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await rev(id)).item.state).toBe('IN_REVIEW');
  });

  it('phải xác nhận khẳng định cần kiểm; giờ đăng phải hợp lệ', async () => {
    const id = await seed('VN');
    const h = packageHash(pkg('VN'));
    await expect(svc.approve(db, vn, id, { revision: 1, packageHash: h, scheduledAt: future(48), claimsConfirmed: false })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(svc.approve(db, vn, id, { revision: 1, packageHash: h, scheduledAt: future(0.1), claimsConfirmed: true })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(svc.approve(db, vn, id, { revision: 1, packageHash: h, scheduledAt: future(24 * 40), claimsConfirmed: true })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('sửa sau khi duyệt: tạo revision mới, quay về chờ duyệt, bỏ giờ hẹn; duyệt cũ không còn hiệu lực', async () => {
    const id = await seed('VN');
    const h1 = packageHash(pkg('VN'));
    await svc.approve(db, vn, id, { revision: 1, packageHash: h1, scheduledAt: future(48), claimsConfirmed: true });
    const rv = await svc.saveEdit(db, vn, id, 1, { headline: 'Tiêu đề mới', body: 'Nội dung tiếng Việt đã được chỉnh sửa cho phù hợp hơn với doanh nghiệp.', call_to_action: 'Liên hệ', hashtags: ['#A'] });
    expect(rv).toBe(2);
    const d2 = await rev(id);
    expect(d2.item).toMatchObject({ state: 'IN_REVIEW', current_revision: 2 });
    expect(d2.item.scheduled_at).toBeNull();
    expect(d2.events.map((e) => e.action)).toContain('EDIT');
    // Hash cũ không dùng được cho bản mới.
    await expect(svc.approve(db, vn, id, { revision: 1, packageHash: h1, scheduledAt: future(48), claimsConfirmed: true })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('sửa với bản cũ (người khác vừa sửa) bị từ chối', async () => {
    const id = await seed('VN');
    const edit = { headline: 'A', body: 'Nội dung tiếng Việt hợp lệ cho bài đăng này.', call_to_action: 'B', hashtags: [] };
    await svc.saveEdit(db, vn, id, 1, edit);
    await expect(svc.saveEdit(db, vn, id, 1, edit)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('sửa sai ngôn ngữ hoặc vượt giới hạn bị từ chối', async () => {
    const vnId = await seed('VN');
    await expect(svc.saveEdit(db, vn, vnId, 1, { headline: 'A', body: 'これは日本語の本文です。', call_to_action: 'B', hashtags: [] })).rejects.toMatchObject({ code: 'INVALID' });
    await expect(svc.saveEdit(db, vn, vnId, 1, { headline: 'A'.repeat(121), body: 'Nội dung tiếng Việt.', call_to_action: 'B', hashtags: [] })).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('bốn mắt cho JP: người sửa cuối không tự duyệt, người khác duyệt được', async () => {
    const id = await seed('JP');
    await svc.saveEdit(db, jp1, id, 1, { headline: '見出し', body: '修正した日本語の本文です。システム開発のご相談をお待ちしております。', call_to_action: 'ご連絡ください', hashtags: ['#DX'] });
    const cur = await rev(id);
    const input = { revision: 2, packageHash: cur.packageHash, scheduledAt: future(48), claimsConfirmed: true };
    await expect(svc.approve(db, jp1, id, input)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await svc.approve(db, jp2, id, input);
    expect((await rev(id)).item.state).toBe('APPROVED');
  });

  it('bốn mắt không áp dụng cho VN', async () => {
    const id = await seed('VN');
    await svc.saveEdit(db, vn, id, 1, { headline: 'A', body: 'Nội dung tiếng Việt đã chỉnh sửa hợp lệ cho bài.', call_to_action: 'B', hashtags: [] });
    const cur = await rev(id);
    await svc.approve(db, vn, id, { revision: 2, packageHash: cur.packageHash, scheduledAt: future(48), claimsConfirmed: true });
    expect((await rev(id)).item.state).toBe('APPROVED');
  });

  it('yêu cầu chỉnh sửa/từ chối cần ghi chú; hủy ghi nhật ký', async () => {
    const a = await seed('VN');
    await expect(svc.requestChanges(db, vn, a, '  ')).rejects.toMatchObject({ code: 'INVALID' });
    await svc.requestChanges(db, vn, a, 'Sửa phần mở đầu');
    expect((await rev(a)).item.state).toBe('CHANGES_REQUESTED');
    const b = await seed('VN');
    await svc.reject(db, vn, b, 'Sai thông tin');
    expect((await rev(b)).item.state).toBe('REJECTED');
    await expect(svc.cancel(db, vn, b)).rejects.toMatchObject({ code: 'CONFLICT' });
    const c = await seed('VN');
    await svc.cancel(db, admin, c, 'Không còn phù hợp');
    expect((await rev(c)).events[0]).toMatchObject({ action: 'CANCEL', actor: 'ad@t' });
  });

  it('nhật ký kiểm toán chỉ liệt kê thị trường được phép', async () => {
    const rows = await svc.listAudit(db, vn);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.market === 'VN')).toBe(true);
  });

  it('nhật ký kiểm toán không cho sửa/xóa ở tầng ứng dụng: dịch vụ không có hàm nào làm vậy', () => {
    expect(Object.keys(svc).some((k) => /delete|remove|purge/i.test(k))).toBe(false);
  });
});
