// Đăng bài lên Meta (P-01/P-02/P-03): hẹn giờ bài đã duyệt, đối soát sau giờ hẹn, hủy an toàn.
// Quy tắc chống đăng trùng: ghi PENDING và cam kết DB TRƯỚC khi gọi Meta; tạo bài không tự thử lại (idempotent=false).
import type pg from 'pg';
import { canCancel, type Actor } from '../auth.ts';
import { packageHash, type ContentPackage, type Market } from '../domain/package.ts';
import { HttpError } from '../domain/retry.ts';
import { feedPost, isDefinitiveRejection, scheduleGate } from '../domain/publish.ts';
import { assertTransition, type State } from '../domain/states.ts';
import type { MetaClient } from '../providers/meta.ts';
import { AppError, getContent, hasPendingPublish } from './contents.ts';

export interface PagePair {
  id: string;
  token: string;
}

export interface PublisherDeps {
  db: pg.Pool;
  meta: MetaClient;
  pages: Partial<Record<Market, PagePair>>;
  now?: () => Date;
}

export type Outcome = 'scheduled' | 'published' | 'failed' | 'returned' | 'skipped' | 'dry-run' | 'removed';
export interface Result {
  id: number;
  outcome: Outcome;
  detail: string;
}

/** Đọc cấu hình Trang từ biến môi trường: FB_VN_PAGE_ID/TOKEN, FB_JP_PAGE_ID/TOKEN. Thiếu cặp nào thì thị trường đó không đăng. */
export function pagesFromEnv(env: NodeJS.ProcessEnv): Partial<Record<Market, PagePair>> {
  const out: Partial<Record<Market, PagePair>> = {};
  for (const m of ['VN', 'JP'] as Market[]) {
    const id = env[`FB_${m}_PAGE_ID`];
    const token = env[`FB_${m}_PAGE_TOKEN`];
    if (id && token) out[m] = { id, token };
  }
  return out;
}

const ACTOR = 'system:publisher';
const clip = (s: string) => s.slice(0, 300);

interface Row {
  id: number;
  market: Market;
  state: State;
  scheduled_at: Date | null;
  fb_post_id: string | null;
  current_revision: number;
}

async function move(c: pg.PoolClient, row: Row, to: State, extra: { fbPostId?: string | null; lastError?: string | null } = {}): Promise<void> {
  assertTransition(row.state, to);
  await c.query('UPDATE content_item SET state = $2, fb_post_id = COALESCE($3, fb_post_id), last_error = $4, updated_at = now() WHERE id = $1', [
    row.id,
    to,
    extra.fbPostId ?? null,
    extra.lastError ?? null,
  ]);
}

async function log(c: pg.PoolClient, row: Row, hash: string, action: string, note: string): Promise<void> {
  await c.query('INSERT INTO approval_event(content_id, revision, package_hash, actor, action, note) VALUES ($1,$2,$3,$4,$5,$6)', [
    row.id,
    row.current_revision,
    hash,
    ACTOR,
    action,
    clip(note),
  ]);
}

async function lockRow(c: pg.PoolClient, id: number): Promise<Row | undefined> {
  const r = await c.query<Row>('SELECT id, market, state, scheduled_at, fb_post_id, current_revision FROM content_item WHERE id = $1 FOR UPDATE', [id]);
  return r.rows[0];
}

type Claim = { kind: 'done'; result: Result } | { kind: 'ready'; row: Row; page: PagePair; pkg: ContentPackage; hash: string; attemptId: number };

/** Bước chốt: khóa bài, kiểm tra, rồi ghi PENDING và commit. Từ đây trở đi nếu tiến trình chết, lần sau sẽ thấy PENDING và dừng. */
async function claim(deps: PublisherDeps, id: number, now: Date, dryRun: boolean): Promise<Claim> {
  const c = await deps.db.connect();
  try {
    await c.query('BEGIN');
    const row = await lockRow(c, id);
    const done = async (outcome: Outcome, detail: string): Promise<Claim> => {
      await c.query('COMMIT');
      return { kind: 'done', result: { id, outcome, detail } };
    };
    if (!row || row.state !== 'APPROVED') {
      await c.query('ROLLBACK');
      return { kind: 'done', result: { id, outcome: 'skipped', detail: row ? `đang ở ${row.state}` : 'không tồn tại' } };
    }
    const page = deps.pages[row.market];
    if (!page) {
      await c.query('ROLLBACK');
      return { kind: 'done', result: { id, outcome: 'skipped', detail: `chưa cấu hình Trang ${row.market}` } };
    }
    const rev = (await c.query<{ package: ContentPackage; package_hash: string }>('SELECT package, package_hash FROM content_revision WHERE content_id = $1 AND revision = $2', [id, row.current_revision])).rows[0];
    if (!rev) {
      await c.query('ROLLBACK');
      return { kind: 'done', result: { id, outcome: 'skipped', detail: 'thiếu revision hiện tại' } };
    }

    if (packageHash(rev.package) !== rev.package_hash) {
      await move(c, row, 'FAILED_PUBLISH', { lastError: 'Hash nội dung không khớp: dữ liệu bị sửa ngoài luồng. Không đăng.' });
      await log(c, row, rev.package_hash, 'PUBLISH_FAILED', 'Hash không khớp');
      return done('failed', 'hash không khớp');
    }
    if (await hasPendingPublish(c, id)) {
      await move(c, row, 'FAILED_PUBLISH', { lastError: 'Lần đăng trước chưa rõ kết quả. Kiểm tra Trang Facebook trước khi xử lý.' });
      await log(c, row, rev.package_hash, 'PUBLISH_FAILED', 'Có lần đăng PENDING từ trước');
      return done('failed', 'có lần đăng chưa rõ kết quả');
    }
    const gate = row.scheduled_at ? scheduleGate(row.scheduled_at, now) : { ok: false as const, reason: 'Thiếu giờ đăng' };
    if (!gate.ok) {
      // Lỗi về giờ không phải lỗi của Meta: đưa bài về duyệt lại để hẹn giờ mới.
      await move(c, row, 'IN_REVIEW', { lastError: gate.reason });
      await log(c, row, rev.package_hash, 'PUBLISH_FAILED', gate.reason);
      return done('returned', gate.reason);
    }
    if (dryRun) {
      await c.query('ROLLBACK');
      return { kind: 'done', result: { id, outcome: 'dry-run', detail: feedPost(rev.package).message.slice(0, 60) } };
    }

    const a = await c.query<{ id: string }>("INSERT INTO publish_attempt(content_id, step, ok, error) VALUES ($1, 'FEED_POST', false, 'PENDING') RETURNING id", [id]);
    await c.query('COMMIT');
    return { kind: 'ready', row, page, pkg: rev.package, hash: rev.package_hash, attemptId: Number(a.rows[0]!.id) };
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

async function recordFailure(deps: PublisherDeps, row: Row, attemptId: number, hash: string, e: unknown): Promise<Result> {
  const definitive = e instanceof HttpError && isDefinitiveRejection(e.status);
  const msg = clip((e as Error).message);
  const c = await deps.db.connect();
  try {
    await c.query('BEGIN');
    await c.query('UPDATE publish_attempt SET ok = false, error = $2, http_status = $3 WHERE id = $1', [
      attemptId,
      definitive ? msg : `UNKNOWN: ${msg}`,
      e instanceof HttpError ? e.status : null,
    ]);
    const note = definitive ? `Meta từ chối: ${msg}` : 'Kết quả đăng không rõ. Kiểm tra Trang Facebook trước khi xử lý. Không tự thử lại.';
    await move(c, { ...row, state: 'APPROVED' }, 'FAILED_PUBLISH', { lastError: clip(note) });
    await log(c, row, hash, 'PUBLISH_FAILED', note);
    await c.query('COMMIT');
    return { id: row.id, outcome: 'failed', detail: definitive ? 'Meta từ chối' : 'kết quả không rõ' };
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}

async function recordSuccess(deps: PublisherDeps, page: PagePair, row: Row, attemptId: number, hash: string, fbId: string, status: number, trace: string | null): Promise<Result> {
  const c = await deps.db.connect();
  let stillApproved = false;
  try {
    await c.query('BEGIN');
    await c.query('UPDATE publish_attempt SET ok = true, error = NULL, http_status = $2, fb_trace_id = $3 WHERE id = $1', [attemptId, status, trace]);
    const cur = await lockRow(c, row.id);
    stillApproved = cur?.state === 'APPROVED';
    if (stillApproved) {
      await move(c, cur!, 'SCHEDULED', { fbPostId: fbId });
      await log(c, row, hash, 'PUBLISH', `Đã hẹn trên Meta: ${fbId}`);
    }
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
  if (stillApproved) return { id: row.id, outcome: 'scheduled', detail: `Meta: ${fbId}` };
  // Hiếm: bài bị hủy trong lúc chờ Meta. Xóa bài vừa tạo để không lên Trang.
  try {
    await deps.meta.deletePost(page.token, fbId);
    return { id: row.id, outcome: 'removed', detail: 'bài đã bị hủy trong lúc đăng; đã xóa bài trên Meta' };
  } catch {
    return { id: row.id, outcome: 'failed', detail: `bài đã bị hủy nhưng chưa xóa được trên Meta (${fbId}). Xóa tay.` };
  }
}

/** Hẹn giờ một bài đã duyệt lên Meta. */
export async function publishOne(deps: PublisherDeps, id: number, dryRun = false): Promise<Result> {
  const now = deps.now?.() ?? new Date();
  const c0 = await claim(deps, id, now, dryRun);
  if (c0.kind === 'done') return c0.result;
  const { row, page, pkg, hash, attemptId } = c0;
  let fbId: string;
  let status: number;
  let trace: string | null;
  try {
    const at = Math.floor(row.scheduled_at!.getTime() / 1000);
    const res = await deps.meta.postFeed(page.token, page.id, { ...feedPost(pkg), published: false, scheduled_publish_time: at });
    fbId = String((res.json as { id?: unknown }).id ?? '');
    if (!fbId) throw new Error('Meta không trả về mã bài');
    status = res.status;
    trace = res.headers.get('x-fb-trace-id');
  } catch (e) {
    return recordFailure(deps, row, attemptId, hash, e);
  }
  return recordSuccess(deps, page, row, attemptId, hash, fbId, status, trace);
}

/** Hẹn giờ tất cả bài APPROVED thuộc các thị trường có cấu hình Trang. */
export async function publishApproved(deps: PublisherDeps, opts: { dryRun?: boolean } = {}): Promise<Result[]> {
  const markets = Object.keys(deps.pages) as Market[];
  if (markets.length === 0) return [];
  const r = await deps.db.query<{ id: string }>("SELECT id FROM content_item WHERE state = 'APPROVED' AND market = ANY($1) ORDER BY scheduled_at NULLS LAST LIMIT 20", [markets]);
  const out: Result[] = [];
  for (const x of r.rows) out.push(await publishOne(deps, Number(x.id), opts.dryRun));
  return out;
}

const GRACE_MS = 60 * 60_000;

/** Đối soát bài đã hẹn: sau giờ hẹn, hỏi Meta xem bài đã đăng chưa. Quá 1 giờ mà không thấy thì báo người. */
export async function reconcileScheduled(deps: PublisherDeps): Promise<Result[]> {
  const now = deps.now?.() ?? new Date();
  const r = await deps.db.query<Row>(
    "SELECT id, market, state, scheduled_at, fb_post_id, current_revision FROM content_item WHERE state = 'SCHEDULED' AND fb_post_id IS NOT NULL AND scheduled_at < $1",
    [new Date(now.getTime() - 2 * 60_000)],
  );
  const out: Result[] = [];
  for (const row of r.rows) {
    const page = deps.pages[row.market];
    if (!page) continue;
    const overdue = now.getTime() > row.scheduled_at!.getTime() + GRACE_MS;
    let published = false;
    let readError: string | null = null;
    try {
      const res = await deps.meta.get(page.token, row.fb_post_id!, { fields: 'id,is_published' });
      published = (res.json as { is_published?: boolean }).is_published === true;
    } catch (e) {
      readError = clip((e as Error).message);
    }
    if (published) {
      const c = await deps.db.connect();
      try {
        await c.query('BEGIN');
        const cur = await lockRow(c, row.id);
        if (cur?.state === 'SCHEDULED') {
          await move(c, cur, 'PUBLISHED');
          const hash = (await c.query<{ package_hash: string }>('SELECT package_hash FROM content_revision WHERE content_id = $1 AND revision = $2', [row.id, row.current_revision])).rows[0]?.package_hash ?? '';
          await log(c, row, hash, 'PUBLISHED', `Meta xác nhận đã đăng: ${row.fb_post_id}`);
        }
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        c.release();
      }
      out.push({ id: row.id, outcome: 'published', detail: 'Meta xác nhận đã đăng' });
    } else if (overdue) {
      const why = readError ? `không đọc được bài trên Meta (${readError})` : 'Meta chưa báo đã đăng';
      const note = `Quá giờ hẹn 1 giờ, ${why}. Kiểm tra Trang thủ công.`;
      const c = await deps.db.connect();
      try {
        await c.query('BEGIN');
        const cur = await lockRow(c, row.id);
        if (cur?.state === 'SCHEDULED') {
          await move(c, cur, 'FAILED_PUBLISH', { lastError: note });
          const hash = (await c.query<{ package_hash: string }>('SELECT package_hash FROM content_revision WHERE content_id = $1 AND revision = $2', [row.id, row.current_revision])).rows[0]?.package_hash ?? '';
          await log(c, row, hash, 'PUBLISH_FAILED', note);
        }
        await c.query('COMMIT');
      } catch (err) {
        await c.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        c.release();
      }
      out.push({ id: row.id, outcome: 'failed', detail: note });
    } else {
      out.push({ id: row.id, outcome: 'skipped', detail: 'chưa tới lúc kiểm tra' });
    }
  }
  return out;
}

/**
 * Hủy bài đã hẹn: xóa bài trên Meta TRƯỚC, chỉ khi xóa thành công mới đổi trạng thái thành CANCELLED.
 * Nếu không xóa được thì giữ nguyên SCHEDULED để không tạo tình trạng "đã hủy trong hệ thống nhưng vẫn đăng trên Meta".
 */
export async function cancelScheduled(deps: PublisherDeps, actor: Actor, id: number, note?: string): Promise<void> {
  const d = await getContent(deps.db, actor, id);
  if (!canCancel(actor, d.item.market)) throw new AppError('FORBIDDEN', 'Bạn không có quyền hủy bài thuộc thị trường này');
  if (d.item.state !== 'SCHEDULED') throw new AppError('CONFLICT', `Bài đang ở ${d.item.state}, không phải đã hẹn giờ`);
  const page = deps.pages[d.item.market];
  if (!page || !d.item.fb_post_id) throw new AppError('CONFLICT', 'Thiếu thông tin bài hẹn trên Meta, không thể hủy an toàn');
  try {
    await deps.meta.deletePost(page.token, d.item.fb_post_id);
  } catch {
    throw new AppError('CONFLICT', 'Không xóa được bài hẹn trên Meta nên chưa hủy. Thử lại sau, hoặc xóa tay trên Meta.');
  }
  const c = await deps.db.connect();
  try {
    await c.query('BEGIN');
    const cur = await lockRow(c, id);
    if (cur?.state !== 'SCHEDULED') throw new AppError('CONFLICT', 'Trạng thái bài đã thay đổi trong lúc hủy. Tải lại trang.');
    await move(c, cur, 'CANCELLED', { lastError: null });
    const hash = (await c.query<{ package_hash: string }>('SELECT package_hash FROM content_revision WHERE content_id = $1 AND revision = $2', [id, cur.current_revision])).rows[0]?.package_hash ?? '';
    await c.query('INSERT INTO approval_event(content_id, revision, package_hash, actor, action, note) VALUES ($1,$2,$3,$4,$5,$6)', [
      id,
      cur.current_revision,
      hash,
      actor.email,
      'CANCEL',
      clip(`Đã xóa bài hẹn trên Meta${note?.trim() ? `. ${note.trim()}` : ''}`),
    ]);
    await c.query('COMMIT');
  } catch (err) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    c.release();
  }
}
