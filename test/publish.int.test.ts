// Tích hợp đăng Meta trên PostgreSQL thật (schema tạm), với Meta giả. Bỏ qua nếu không có TEST_DATABASE_URL.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDb } from './helpers/freshDb.ts';
import type { Actor } from '../src/auth.ts';
import { packageHash, type ContentPackage } from '../src/domain/package.ts';
import { HttpError } from '../src/domain/retry.ts';
import type { MetaClient } from '../src/providers/meta.ts';
import * as svc from '../src/services/contents.ts';
import { cancelScheduled, publishApproved, publishOne, reconcileScheduled, type PublisherDeps } from '../src/services/publish.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql'];

const vn: Actor = { email: 'vn@t', name: 'VN', roles: ['approver_vn'] };
const future = (min: number) => new Date(Date.now() + min * 60_000);
const ok = (json: unknown) => ({ status: 200, json, headers: new Headers() });

const pkg = (): ContentPackage => ({
  market: 'VN',
  topic_summary: 'tóm tắt',
  post: { headline: 'Tiêu đề kiểm thử', body: 'Đây là nội dung tiếng Việt để kiểm thử đăng bài.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#DX'] },
  sources: [{ title: 'Nguồn', url: 'https://example.com/a' }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});

d('đăng Meta (PostgreSQL thật, Meta giả)', () => {
  let drop: (() => Promise<void>) | undefined;  let db: pg.Pool;
  let mock: { postFeed: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; deletePost: ReturnType<typeof vi.fn> };
  let deps: PublisherDeps;

  beforeAll(async () => {
    const fresh = await freshDb(URL_!, MIGRATIONS);
    db = fresh.db;
    drop = fresh.drop;
  });
  afterAll(async () => {
    await drop?.();
  });
  beforeEach(() => {
    mock = {
      postFeed: vi.fn(async () => ok({ id: 'PG_1_POST' })),
      get: vi.fn(async () => ok({ id: 'PG_1_POST', is_published: false })),
      deletePost: vi.fn(async () => ok({ success: true })),
    };
    deps = { db, meta: mock as unknown as MetaClient, pages: { VN: { id: 'PG1', token: 'TOKEN' } } };
  });

  /** Tạo một bài đã duyệt, hẹn 3 giờ sau. */
  async function approvedItem(): Promise<number> {
    const p = pkg();
    const id = await svc.createGenerated(db, p, 'test');
    await svc.approve(db, vn, id, { revision: 1, packageHash: packageHash(p), scheduledAt: future(180), claimsConfirmed: true });
    return id;
  }
  const stateOf = async (id: number) => (await db.query<{ state: string }>('SELECT state FROM content_item WHERE id = $1', [id])).rows[0]!.state;
  const attemptsOf = async (id: number) => (await db.query<{ ok: boolean; error: string | null }>('SELECT ok, error FROM publish_attempt WHERE content_id = $1 ORDER BY id', [id])).rows;

  it('hẹn bài đã duyệt: gửi published=false và giờ hẹn; ghi ID bài; SCHEDULED', async () => {
    const id = await approvedItem();
    const r = await publishOne(deps, id);
    expect(r.outcome).toBe('scheduled');
    expect(await stateOf(id)).toBe('SCHEDULED');
    const body = mock.postFeed.mock.calls[0]![2] as { published: boolean; scheduled_publish_time: number; link: string };
    expect(body.published).toBe(false);
    expect(body.link).toBe('https://example.com/a');
    expect(Math.abs(body.scheduled_publish_time * 1000 - Date.now() - 180 * 60_000)).toBeLessThan(120_000);
    expect((await db.query('SELECT fb_post_id FROM content_item WHERE id = $1', [id])).rows[0].fb_post_id).toBe('PG_1_POST');
    expect(await attemptsOf(id)).toEqual([{ ok: true, error: null }]);
  });

  it('Meta từ chối (400): FAILED_PUBLISH, không tự thử lại', async () => {
    const id = await approvedItem();
    mock.postFeed.mockRejectedValueOnce(new HttpError(400, 'HTTP 400 /feed: sai tham số'));
    const r = await publishOne(deps, id);
    expect(r.outcome).toBe('failed');
    expect(await stateOf(id)).toBe('FAILED_PUBLISH');
    expect(mock.postFeed).toHaveBeenCalledTimes(1);
    expect((await attemptsOf(id))[0]).toMatchObject({ ok: false });
  });

  it('lỗi không rõ (500): FAILED_PUBLISH với nhãn UNKNOWN, không gọi lại Meta', async () => {
    const id = await approvedItem();
    mock.postFeed.mockRejectedValueOnce(new HttpError(500, 'HTTP 500 /feed'));
    await publishOne(deps, id);
    expect(await stateOf(id)).toBe('FAILED_PUBLISH');
    expect((await attemptsOf(id))[0]!.error).toMatch(/^UNKNOWN/);
    expect(mock.postFeed).toHaveBeenCalledTimes(1);
  });

  it('có lần PENDING từ trước (tiến trình chết giữa chừng): dừng, KHÔNG gọi Meta', async () => {
    const id = await approvedItem();
    await db.query("INSERT INTO publish_attempt(content_id, step, ok, error) VALUES ($1,'FEED_POST',false,'PENDING')", [id]);
    const r = await publishOne(deps, id);
    expect(r.outcome).toBe('failed');
    expect(mock.postFeed).not.toHaveBeenCalled();
    expect(await stateOf(id)).toBe('FAILED_PUBLISH');
  });

  it('giờ hẹn còn dưới 15 phút khi đăng: đưa về IN_REVIEW để hẹn lại', async () => {
    const id = await approvedItem();
    await db.query("UPDATE content_item SET scheduled_at = now() + interval '5 minutes' WHERE id = $1", [id]);
    const r = await publishOne(deps, id);
    expect(r.outcome).toBe('returned');
    expect(await stateOf(id)).toBe('IN_REVIEW');
    expect(mock.postFeed).not.toHaveBeenCalled();
  });

  it('chạy thử (dry-run): không gọi Meta, không đổi trạng thái', async () => {
    const id = await approvedItem();
    const out = await publishApproved(deps, { dryRun: true });
    expect(out.find((x) => x.id === id)?.outcome).toBe('dry-run');
    expect(mock.postFeed).not.toHaveBeenCalled();
    expect(await stateOf(id)).toBe('APPROVED');
  });

  it('đối soát: Meta báo đã đăng thì PUBLISHED; quá 1 giờ mà chưa thấy thì FAILED_PUBLISH', async () => {
    const a = await approvedItem();
    await publishOne(deps, a);
    await db.query("UPDATE content_item SET scheduled_at = now() - interval '10 minutes' WHERE id = $1", [a]);
    mock.get.mockResolvedValueOnce(ok({ id: 'PG_1_POST', is_published: true }));
    await reconcileScheduled(deps);
    expect(await stateOf(a)).toBe('PUBLISHED');

    const b = await approvedItem();
    await publishOne(deps, b);
    await db.query("UPDATE content_item SET scheduled_at = now() - interval '2 hours' WHERE id = $1", [b]);
    mock.get.mockResolvedValueOnce(ok({ id: 'PG_1_POST', is_published: false }));
    await reconcileScheduled(deps);
    expect(await stateOf(b)).toBe('FAILED_PUBLISH');
  });

  it('hủy bài đã hẹn: xóa trên Meta trước, rồi mới CANCELLED và ghi kiểm toán', async () => {
    const id = await approvedItem();
    await publishOne(deps, id);
    await cancelScheduled(deps, vn, id, 'Không cần nữa');
    expect(mock.deletePost).toHaveBeenCalledWith('TOKEN', 'PG_1_POST');
    expect(await stateOf(id)).toBe('CANCELLED');
    const ev = (await db.query("SELECT action, note FROM approval_event WHERE content_id = $1 AND action = 'CANCEL'", [id])).rows[0];
    expect(ev.note).toContain('Đã xóa bài hẹn trên Meta');
  });

  it('xóa trên Meta thất bại: KHÔNG hủy trong hệ thống, giữ SCHEDULED', async () => {
    const id = await approvedItem();
    await publishOne(deps, id);
    mock.deletePost.mockRejectedValueOnce(new HttpError(500, 'HTTP 500'));
    await expect(cancelScheduled(deps, vn, id)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await stateOf(id)).toBe('SCHEDULED');
  });

  it('bài đã hẹn không sửa được; bài đang đăng không hủy được', async () => {
    const id = await approvedItem();
    await publishOne(deps, id);
    const cur = (await svc.getContent(db, vn, id)).packageHash;
    await expect(svc.saveEdit(db, vn, id, 1, { headline: 'Mới', body: 'Nội dung tiếng Việt mới để sửa bài đã hẹn.', call_to_action: 'Ok', hashtags: [] })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(cur).toBeTruthy();

    const other = await approvedItem();
    await db.query("INSERT INTO publish_attempt(content_id, step, ok, error) VALUES ($1,'FEED_POST',false,'PENDING')", [other]);
    await expect(svc.cancel(db, vn, other)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await stateOf(other)).toBe('APPROVED');
  });
});
