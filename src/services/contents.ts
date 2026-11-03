import type pg from 'pg';
import { canCancel, canReview, visibleMarkets, type Actor } from '../auth.ts';
import { languageMatchesMarket, packageHash, validatePackage, type ContentPackage, type Market } from '../domain/package.ts';
import { checkScheduleWindow } from '../domain/schedule.ts';
import { assertTransition, canTransition, type State } from '../domain/states.ts';

export class AppError extends Error {
  constructor(
    readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT' | 'INVALID',
    message: string,
  ) {
    super(message);
  }
}

export interface ContentRow {
  id: number;
  market: Market;
  format: string;
  media_engine: string;
  state: State;
  current_revision: number;
  scheduled_at: Date | null;
  fb_post_id: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ContentDetail {
  item: ContentRow;
  package: ContentPackage;
  packageHash: string;
  editedBy: string | null;
  model: string | null;
  events: { action: string; actor: string; revision: number; note: string | null; created_at: Date }[];
}

export interface ServiceOptions {
  /** Thị trường áp dụng "bốn mắt": người sửa cuối không được duyệt (FR-REV-02). */
  fourEyesMarkets: Market[];
}

const DEFAULTS: ServiceOptions = { fourEyesMarkets: ['JP'] };

export async function listContents(db: pg.Pool, actor: Actor, filter: { state?: string; market?: string } = {}): Promise<ContentRow[]> {
  const markets = visibleMarkets(actor);
  if (markets.length === 0) return [];
  const params: unknown[] = [markets];
  let where = 'market = ANY($1)';
  if (filter.state) { params.push(filter.state); where += ` AND state = $${params.length}`; }
  if (filter.market && markets.includes(filter.market as Market)) { params.push(filter.market); where += ` AND market = $${params.length}`; }
  const r = await db.query<ContentRow>(`SELECT * FROM content_item WHERE ${where} ORDER BY (state='IN_REVIEW') DESC, updated_at DESC LIMIT 200`, params);
  return r.rows;
}

export async function getContent(db: pg.Pool | pg.PoolClient, actor: Actor, id: number): Promise<ContentDetail> {
  const it = await db.query<ContentRow>('SELECT * FROM content_item WHERE id = $1', [id]);
  const item = it.rows[0];
  // Không lộ sự tồn tại của bài thuộc thị trường không được phép.
  if (!item || !visibleMarkets(actor).includes(item.market)) throw new AppError('NOT_FOUND', 'Không tìm thấy bài');
  const rev = await db.query('SELECT package, package_hash, edited_by, model FROM content_revision WHERE content_id = $1 AND revision = $2', [id, item.current_revision]);
  const r = rev.rows[0];
  if (!r) throw new AppError('CONFLICT', 'Thiếu revision hiện tại');
  const ev = await db.query('SELECT action, actor, revision, note, created_at FROM approval_event WHERE content_id = $1 ORDER BY id DESC', [id]);
  return { item, package: r.package as ContentPackage, packageHash: r.package_hash as string, editedBy: r.edited_by, model: r.model, events: ev.rows };
}

async function lockItem(c: pg.PoolClient, actor: Actor, id: number): Promise<ContentRow> {
  const r = await c.query<ContentRow>('SELECT * FROM content_item WHERE id = $1 FOR UPDATE', [id]);
  const item = r.rows[0];
  if (!item || !visibleMarkets(actor).includes(item.market)) throw new AppError('NOT_FOUND', 'Không tìm thấy bài');
  return item;
}

async function tx<T>(db: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await db.connect();
  try {
    await c.query('BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}

async function currentRevision(c: pg.PoolClient, item: ContentRow) {
  const r = await c.query('SELECT package, package_hash, edited_by FROM content_revision WHERE content_id = $1 AND revision = $2', [item.id, item.current_revision]);
  return r.rows[0] as { package: ContentPackage; package_hash: string; edited_by: string | null };
}

async function audit(c: pg.PoolClient, item: ContentRow, revision: number, hash: string, actor: Actor, action: string, note?: string) {
  await c.query('INSERT INTO approval_event(content_id, revision, package_hash, actor, action, note) VALUES ($1,$2,$3,$4,$5,$6)', [item.id, revision, hash, actor.email, action, note ?? null]);
}

async function setState(c: pg.PoolClient, item: ContentRow, to: State, extra: { scheduledAt?: Date | null; revision?: number } = {}) {
  assertTransition(item.state, to);
  await c.query('UPDATE content_item SET state = $2, scheduled_at = $3, current_revision = $4, updated_at = now() WHERE id = $1', [
    item.id, to, extra.scheduledAt === undefined ? item.scheduled_at : extra.scheduledAt, extra.revision ?? item.current_revision,
  ]);
}

export interface EditInput {
  headline: string;
  body: string;
  call_to_action: string;
  hashtags: string[];
}

/** Sửa nội dung = revision mới, bài quay về IN_REVIEW (FR-REV-03). Duyệt cũ không còn hiệu lực. */
export async function saveEdit(db: pg.Pool, actor: Actor, id: number, baseRevision: number, input: EditInput): Promise<number> {
  return tx(db, async (c) => {
    const item = await lockItem(c, actor, id);
    if (!canReview(actor, item.market)) throw new AppError('FORBIDDEN', 'Bạn không có quyền sửa bài thuộc thị trường này');
    if (item.current_revision !== baseRevision) throw new AppError('CONFLICT', 'Bài đã được người khác sửa. Hãy tải lại trang.');
    if (!['IN_REVIEW', 'APPROVED', 'SCHEDULED'].includes(item.state)) throw new AppError('CONFLICT', `Không thể sửa bài ở trạng thái ${item.state}`);

    const cur = await currentRevision(c, item);
    const next: ContentPackage = { ...cur.package, post: { headline: input.headline.trim(), body: input.body.trim(), call_to_action: input.call_to_action.trim(), hashtags: input.hashtags } };
    const v = validatePackage(next);
    if (!v.ok) throw new AppError('INVALID', `Nội dung không hợp lệ: ${v.errors.join('; ')}`);
    if (!languageMatchesMarket(next.post.body, item.market)) throw new AppError('INVALID', item.market === 'JP' ? 'Thân bài phải bằng tiếng Nhật' : 'Thân bài phải bằng tiếng Việt');

    const rev = item.current_revision + 1;
    const hash = packageHash(next);
    await c.query('INSERT INTO content_revision(content_id, revision, package, package_hash, edited_by) VALUES ($1,$2,$3,$4,$5)', [id, rev, JSON.stringify(next), hash, actor.email]);
    if (item.state !== 'IN_REVIEW') await setState(c, item, 'IN_REVIEW', { scheduledAt: null, revision: rev });
    else await c.query('UPDATE content_item SET current_revision = $2, updated_at = now() WHERE id = $1', [id, rev]);
    await audit(c, item, rev, hash, actor, 'EDIT', item.state === 'IN_REVIEW' ? undefined : `Sửa sau khi ${item.state}: duyệt trước đó bị hủy hiệu lực`);
    return rev;
  });
}

export interface ApproveInput {
  revision: number;
  packageHash: string;
  scheduledAt: Date;
  claimsConfirmed: boolean;
}

export async function approve(db: pg.Pool, actor: Actor, id: number, input: ApproveInput, opts: ServiceOptions = DEFAULTS, now = new Date()): Promise<void> {
  await tx(db, async (c) => {
    const item = await lockItem(c, actor, id);
    if (!canReview(actor, item.market)) throw new AppError('FORBIDDEN', 'Bạn không có quyền duyệt bài thuộc thị trường này');
    if (item.state !== 'IN_REVIEW') throw new AppError('CONFLICT', `Bài đang ở trạng thái ${item.state}, không thể duyệt`);
    const cur = await currentRevision(c, item);
    // Duyệt gắn đúng revision và hash người duyệt đã nhìn thấy (FR-REV-03).
    if (input.revision !== item.current_revision || input.packageHash !== cur.package_hash) throw new AppError('CONFLICT', 'Nội dung đã thay đổi sau khi bạn mở trang. Hãy tải lại và xem lại.');
    if (packageHash(cur.package) !== cur.package_hash) throw new AppError('CONFLICT', 'Hash nội dung không khớp (dữ liệu bị sửa ngoài luồng)');
    if (opts.fourEyesMarkets.includes(item.market) && cur.edited_by === actor.email) throw new AppError('FORBIDDEN', 'Bốn mắt: người sửa cuối cùng không được tự duyệt');
    if (cur.package.claims_to_verify.length > 0 && !input.claimsConfirmed) throw new AppError('INVALID', 'Phải xác nhận đã kiểm tra các khẳng định cần kiểm');
    const w = checkScheduleWindow(input.scheduledAt, now);
    if (!w.ok) throw new AppError('INVALID', w.reason === 'TOO_SOON' ? 'Giờ đăng phải cách hiện tại ít nhất 15 phút' : 'Giờ đăng phải trong vòng 29 ngày');
    await setState(c, item, 'APPROVED', { scheduledAt: input.scheduledAt });
    await audit(c, item, item.current_revision, cur.package_hash, actor, 'APPROVE', `Hẹn ${input.scheduledAt.toISOString()}`);
  });
}

async function simpleTransition(db: pg.Pool, actor: Actor, id: number, to: State, action: 'REQUEST_CHANGES' | 'REJECT' | 'CANCEL', note: string | undefined, needNote: boolean) {
  await tx(db, async (c) => {
    const item = await lockItem(c, actor, id);
    const allowed = action === 'CANCEL' ? canCancel(actor, item.market) : canReview(actor, item.market);
    if (!allowed) throw new AppError('FORBIDDEN', 'Bạn không có quyền thực hiện thao tác này với bài thuộc thị trường này');
    if (needNote && !note?.trim()) throw new AppError('INVALID', 'Cần nhập ghi chú/lý do');
    if (!canTransition(item.state, to)) throw new AppError('CONFLICT', `Bài đang ở trạng thái ${item.state}, không thể chuyển sang ${to}`);
    const cur = await currentRevision(c, item);
    await setState(c, item, to, to === 'CANCELLED' ? { scheduledAt: null } : {});
    await audit(c, item, item.current_revision, cur.package_hash, actor, action, note?.trim());
  });
}

export const requestChanges = (db: pg.Pool, a: Actor, id: number, note: string) => simpleTransition(db, a, id, 'CHANGES_REQUESTED', 'REQUEST_CHANGES', note, true);
export const reject = (db: pg.Pool, a: Actor, id: number, reason: string) => simpleTransition(db, a, id, 'REJECTED', 'REJECT', reason, true);
export const cancel = (db: pg.Pool, a: Actor, id: number, note?: string) => simpleTransition(db, a, id, 'CANCELLED', 'CANCEL', note, false);

export async function listAudit(db: pg.Pool, actor: Actor, limit = 100) {
  const markets = visibleMarkets(actor);
  const r = await db.query(
    `SELECT e.id, e.content_id, e.revision, e.action, e.actor, e.note, e.created_at, c.market
       FROM approval_event e JOIN content_item c ON c.id = e.content_id
      WHERE c.market = ANY($1) ORDER BY e.id DESC LIMIT $2`, [markets, limit]);
  return r.rows as { id: number; content_id: number; revision: number; action: string; actor: string; note: string | null; created_at: Date; market: Market }[];
}

/** Ghi một gói do AI sinh vào hàng chờ (IN_REVIEW, revision 1, không có người sửa). Chỉ dùng từ tiến trình nền. */
export async function createGenerated(db: pg.Pool, pkg: ContentPackage, model: string): Promise<number> {
  const engine = pkg.media.engine;
  const format = engine === 'NONE' ? 'TEXT' : engine === 'REMOTION_CARD' ? 'IMAGE' : 'REEL';
  const hash = packageHash(pkg);
  return tx(db, async (c) => {
    const it = await c.query<{ id: string }>(
      `INSERT INTO content_item(market, page_key, format, media_engine, state) VALUES ($1,$1,$2,$3,'IN_REVIEW') RETURNING id`,
      [pkg.market, format, engine],
    );
    const id = Number(it.rows[0]!.id);
    await c.query('INSERT INTO content_revision(content_id, revision, package, package_hash, model) VALUES ($1,1,$2,$3,$4)', [id, JSON.stringify(pkg), hash, model]);
    return id;
  });
}
