import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { canCancel, canReview, checkCsrf, csrfToken, verifyPassword, signSession, verifySession, visibleMarkets, type Actor, type Role } from '../auth.ts';
import { fromLocalInput, nextBusinessSlot, DEFAULT_LOCAL_TIME, toLocalInput } from '../domain/schedule.ts';
import type { Market } from '../domain/package.ts';
import type { GeminiClient } from '../providers/gemini.ts';
import * as svc from '../services/contents.ts';
import { AppError } from '../services/contents.ts';
import { getStats, pendingCount } from '../services/stats.ts';
import { cancelScheduled, publishApproved, publishOne, reconcileScheduled, type PublisherDeps } from '../services/publish.ts';
import { generateNews, fetchFeeds } from '../services/generate.ts';
import { isPaused, setPaused } from '../services/settings.ts';
import { createUser, listUsers, resetPassword, setDisabled } from '../services/users.ts';
import { page, type Flash } from './layout.ts';
import { html as h } from './html.ts';
import { CSS } from './styles.ts';
import { auditView } from './views/audit.ts';
import { dashboardView } from './views/dashboard.ts';
import { scheduleView } from './views/schedule.ts';
import { detailView } from './views/detail.ts';
import { loginView } from './views/login.ts';
import { queueView, type RowInfo } from './views/queue.ts';
import { usersView } from './views/users.ts';

export interface WebOptions {
  db: pg.Pool;
  sessionSecret: string;
  cookieSecure: boolean;
  fourEyesMarkets?: Market[];
  /** Có khi đã cấu hình Trang Meta. Thiếu thì không đăng và không hủy được bài đã hẹn (không xóa được bên Meta). */
  publisher?: PublisherDeps;
  /** Có khi đã cấu hình khóa Gemini. Thiếu thì không tạo được bản tin mới từ giao diện. */
  generator?: { gemini: GeminiClient; schema: object };
}

const SESSION_TTL = 8 * 3600;
const OK_MESSAGES: Record<string, string> = {
  approved: 'Đã duyệt và hẹn giờ đăng.',
  changes: 'Đã gửi yêu cầu chỉnh sửa.',
  rejected: 'Đã từ chối bài.',
  cancelled: 'Đã hủy bài.',
  edited: 'Đã lưu chỉnh sửa. Bài đang chờ duyệt.',
  published: 'Đã hẹn bài lên Trang Facebook.',
  paused: 'Đã BẬT công tắc tạm dừng: không hẹn bài mới và không sinh bài mới.',
  resumed: 'Đã TẮT công tắc tạm dừng. Hệ thống hoạt động bình thường.',
};

// Giới hạn thử đăng nhập: 5 lần sai / 15 phút cho mỗi (IP + email). Bộ nhớ trong đủ cho một tiến trình duy nhất.
const FAILS = new Map<string, { n: number; until: number }>();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;

function throttled(key: string, now = Date.now()): boolean {
  const f = FAILS.get(key);
  if (!f) return false;
  if (f.until < now) { FAILS.delete(key); return false; }
  return f.n >= MAX_FAILS;
}
function noteFail(key: string, now = Date.now()) {
  const f = FAILS.get(key);
  FAILS.set(key, { n: (f && f.until >= now ? f.n : 0) + 1, until: now + LOCK_MS });
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const isApprover = (a: Actor) => a.roles.some((r) => r.startsWith('approver_'));
const isAdmin = (a: Actor) => a.roles.includes('admin');

export async function registerWeb(app: FastifyInstance, o: WebOptions): Promise<void> {
  const secret = o.sessionSecret;
  const svcOpts = { fourEyesMarkets: o.fourEyesMarkets ?? (['JP'] as Market[]) };

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'self'; img-src 'self' data: https:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.get('/assets/app.css', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=300').type('text/css; charset=utf-8').send(CSS));

  interface Session { actor: Actor; sid: string; csrf: string; pending: number; paused: boolean }

  async function session(req: FastifyRequest): Promise<Session | null> {
    const sid = req.cookies['sid'];
    const s = verifySession(sid, secret);
    if (!sid || !s) return null;
    const r = await o.db.query<{ email: string; display_name: string; roles: Role[]; disabled: boolean }>('SELECT email, display_name, roles, disabled FROM app_user WHERE email = $1', [s.email]);
    const u = r.rows[0];
    if (!u || u.disabled) return null; // vô hiệu hóa tài khoản có hiệu lực ngay, không đợi hết phiên
    const actor: Actor = { email: u.email, name: u.display_name, roles: u.roles };
    return { actor, sid, csrf: csrfToken(sid, secret), pending: await pendingCount(o.db, actor), paused: await isPaused(o.db) };
  }

  const html = (reply: FastifyReply, body: string, code = 200) => reply.code(code).type('text/html; charset=utf-8').send(body);
  const ctxOf = (s: Session) => ({ user: { name: s.actor.name, email: s.actor.email, roles: s.actor.roles }, csrf: s.csrf, pending: s.pending, paused: s.paused });

  /** Bao một handler cần đăng nhập; với POST thì kiểm tra CSRF trước. */
  const guarded = (fn: (s: Session, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) => async (req: FastifyRequest, reply: FastifyReply) => {
    const s = await session(req);
    if (!s) return reply.redirect('/login');
    if (req.method === 'POST' && !checkCsrf(str((req.body as Record<string, unknown> | undefined)?._csrf), s.sid, secret)) {
      return html(reply, loginView({ flash: { kind: 'err', text: 'Phiên không hợp lệ. Vui lòng đăng nhập lại.' } }), 403);
    }
    return fn(s, req, reply);
  };

  /** Chỉ quản trị viên. Người khác nhận trang 403 chứ không bị chuyển hướng (không lộ chức năng). */
  const adminOnly = (fn: (s: Session, req: FastifyRequest, reply: FastifyReply) => Promise<unknown>) =>
    guarded(async (s, req, reply) => {
      if (!isAdmin(s.actor)) return html(reply, forbiddenPage(ctxOf(s)), 403);
      return fn(s, req, reply);
    });

  // --- tổng quan ---
  app.get('/', guarded(async (s, req, reply) => {
    const [stats, recent] = await Promise.all([getStats(o.db, s.actor), svc.listAudit(o.db, s.actor, 6)]);
    const okMsg = OK_MESSAGES[str((req.query as Record<string, unknown>).ok)];
    return html(reply, dashboardView(ctxOf(s), stats, recent, visibleMarkets(s.actor), {
      metaOn: !!o.publisher,
      geminiOn: !!o.generator,
      paused: s.paused,
      isAdmin: isAdmin(s.actor),
      flash: okMsg ? { kind: 'ok', text: okMsg } : undefined,
    }));
  }));

  app.get('/schedule', guarded(async (s, _req, reply) => {
    const r = await o.db.query(
      `SELECT i.id, i.market, i.state, i.scheduled_at, r.package->'post'->>'headline' AS headline, i.fb_post_id
         FROM content_item i JOIN content_revision r ON r.content_id = i.id AND r.revision = i.current_revision
        WHERE i.market = ANY($1) AND i.state IN ('APPROVED','SCHEDULED','PUBLISHED') AND i.scheduled_at IS NOT NULL
        ORDER BY i.scheduled_at`, [visibleMarkets(s.actor)]);
    return html(reply, scheduleView(ctxOf(s), r.rows.map((x) => ({ ...x, id: Number(x.id) }))));
  }));

  // --- đăng nhập / đăng xuất ---
  app.get('/login', async (_req, reply) => html(reply, loginView({})));

  app.post('/login', async (req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const email = str(b.email).trim().toLowerCase();
    const key = `${req.ip}|${email}`;
    if (throttled(key)) return html(reply, loginView({ email, flash: { kind: 'err', text: 'Thử quá nhiều lần. Vui lòng đợi 15 phút.' } }), 429);
    const r = await o.db.query<{ password_hash: string; disabled: boolean }>('SELECT password_hash, disabled FROM app_user WHERE email = $1', [email]);
    const u = r.rows[0];
    // Luôn băm một lần dù email không tồn tại để thời gian phản hồi không lộ email nào hợp lệ.
    const ok = verifyPassword(str(b.password), u?.password_hash ?? 'scrypt$00$00') && !!u && !u.disabled;
    if (!ok) {
      noteFail(key);
      return html(reply, loginView({ email, flash: { kind: 'err', text: 'Email hoặc mật khẩu không đúng.' } }), 401);
    }
    FAILS.delete(key);
    reply.setCookie('sid', signSession({ email }, secret, SESSION_TTL), { httpOnly: true, sameSite: 'lax', secure: o.cookieSecure, path: '/', maxAge: SESSION_TTL });
    return reply.redirect('/queue');
  });

  app.post('/logout', async (req, reply) => {
    const s = await session(req);
    if (s && !checkCsrf(str((req.body as Record<string, unknown> | undefined)?._csrf), s.sid, secret)) return reply.code(403).send('Forbidden');
    reply.clearCookie('sid', { path: '/' });
    return reply.redirect('/login');
  });

  // --- hàng chờ ---
  async function renderQueue(s: Session, reply: FastifyReply, query: Record<string, unknown>, flash?: Flash) {
    const filter = { state: str(query.state), market: str(query.market), q: str(query.q) };
    const rows = await svc.listContents(o.db, s.actor, filter);
    const info = new Map<string, RowInfo>();
    if (rows.length) {
      const t = await o.db.query<{ content_id: string; headline: string; claims: number; sources: number; edited_by: string | null }>(
        `SELECT r.content_id, r.package->'post'->>'headline' AS headline,
                jsonb_array_length(r.package->'claims_to_verify') AS claims,
                jsonb_array_length(r.package->'sources') AS sources, r.edited_by
           FROM content_revision r JOIN content_item i ON i.id = r.content_id AND i.current_revision = r.revision
          WHERE r.content_id = ANY($1)`, [rows.map((r) => r.id)]);
      for (const x of t.rows) info.set(String(x.content_id), { headline: x.headline, claims: x.claims, sources: x.sources, editedBy: x.edited_by });
    }
    const counts = (await getStats(o.db, s.actor)).byState;
    const markets = visibleMarkets(s.actor);
    return html(reply, queueView({
      ctx: ctxOf(s), rows, info, counts, now: new Date(), filter, markets, flash,
      canGenerate: !!o.generator && markets.some((m) => canReview(s.actor, m)),
      canPublish: !!o.publisher && isApprover(s.actor),
    }));
  }

  app.get('/queue', guarded(async (s, req, reply) => {
    const q = req.query as Record<string, unknown>;
    const okMsg = OK_MESSAGES[str(q.ok)];
    return renderQueue(s, reply, q, okMsg ? { kind: 'ok', text: okMsg } : undefined);
  }));

  app.post('/queue/generate', guarded(async (s, req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const market = str(b.market).toUpperCase() as Market;
    const limit = Math.min(3, Math.max(1, Number(b.limit) || 1));
    if (!o.generator) return renderQueue(s, reply, {}, { kind: 'err', text: 'Chưa cấu hình khóa Gemini (GEMINI_API_KEY), không tạo được bản tin.' });
    if (!['VN', 'JP'].includes(market) || !canReview(s.actor, market)) return renderQueue(s, reply, {}, { kind: 'err', text: 'Bạn không có quyền tạo bản tin cho thị trường này.' });
    const results = await generateNews({ db: o.db, gemini: o.generator.gemini, schema: o.generator.schema, fetchItems: fetchFeeds }, { market, limit, model: 'gemini-3.6-flash' });
    const made = results.filter((r) => r.outcome === 'created').length;
    const skipped = results.filter((r) => r.outcome === 'skipped' && r.detail !== 'Công tắc tạm dừng đang bật').length;
    const failed = results.filter((r) => r.outcome === 'error').length;
    const paused = results.some((r) => r.detail === 'Công tắc tạm dừng đang bật');
    const text = paused
      ? 'Công tắc tạm dừng đang bật: không sinh bài mới.'
      : `Đã tạo ${made} bản tin ${market} vào hàng chờ${skipped ? `, bỏ qua ${skipped} mục không đạt kiểm tra` : ''}${failed ? `, ${failed} lỗi gọi AI` : ''}.`;
    return renderQueue(s, reply, {}, { kind: made || paused ? 'ok' : 'warn', text });
  }));

  app.post('/queue/publish-approved', guarded(async (s, _req, reply) => {
    if (!o.publisher || !isApprover(s.actor)) return renderQueue(s, reply, {}, { kind: 'err', text: 'Không có quyền hoặc chưa cấu hình Trang Meta.' });
    const pub = await publishApproved(o.publisher);
    const rec = await reconcileScheduled(o.publisher);
    const count = (list: { outcome: string }[], k: string) => list.filter((x) => x.outcome === k).length;
    const paused = pub.some((x) => x.id === 0);
    const text = `Hẹn lên Trang: ${count(pub, 'scheduled')} thành công, ${count(pub, 'failed')} lỗi, ${count(pub, 'returned')} cần hẹn lại. Đối soát: ${count(rec, 'published')} đã đăng.${paused ? ' Công tắc tạm dừng đang bật nên không hẹn bài mới.' : ''}`;
    const kind = count(pub, 'failed') ? 'warn' : 'ok';
    return renderQueue(s, reply, {}, { kind, text });
  }));

  // --- chi tiết ---
  async function showDetail(s: Session, reply: FastifyReply, id: number, extra: { flash?: Flash; draft?: { headline: string; body: string; call_to_action: string; hashtags: string }; code?: number } = {}) {
    const d = await svc.getContent(o.db, s.actor, id);
    const slot = nextBusinessSlot(d.item.market, DEFAULT_LOCAL_TIME[d.item.market]);
    return html(reply, detailView({
      ctx: ctxOf(s), d, csrf: s.csrf,
      can: { review: canReview(s.actor, d.item.market), cancel: canCancel(s.actor, d.item.market) },
      blockedByFourEyes: svcOpts.fourEyesMarkets.includes(d.item.market) && d.editedBy === s.actor.email,
      scheduleDefault: toLocalInput(d.item.scheduled_at ?? slot, d.item.market),
      canPublish: !!o.publisher && canReview(s.actor, d.item.market) && d.item.state === 'APPROVED',
      fbUrl: d.item.fb_post_id ? `https://www.facebook.com/${d.item.fb_post_id}` : undefined,
      draft: extra.draft, flash: extra.flash,
    }), extra.code ?? 200);
  }

  const idOf = (req: FastifyRequest): number => {
    const n = Number((req.params as { id?: string }).id);
    if (!Number.isInteger(n) || n <= 0) throw new AppError('NOT_FOUND', 'Không tìm thấy bài');
    return n;
  };

  const CODE: Record<AppError['code'], number> = { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID: 422 };

  /** Thực hiện thao tác; thành công thì quay về hàng chờ, lỗi nghiệp vụ thì hiện lại trang chi tiết kèm thông báo. */
  const action = (okKey: string, run: (s: Session, id: number, b: Record<string, unknown>) => Promise<void>, draftOf?: (b: Record<string, unknown>) => { headline: string; body: string; call_to_action: string; hashtags: string }) =>
    guarded(async (s, req, reply) => {
      const id = idOf(req);
      const b = (req.body ?? {}) as Record<string, unknown>;
      try {
        await run(s, id, b);
        return reply.redirect(`/queue?ok=${okKey}`);
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        if (e.code === 'NOT_FOUND') return html(reply, notFound(s), 404);
        return showDetail(s, reply, id, { flash: { kind: 'err', text: e.message }, draft: e.code === 'INVALID' ? draftOf?.(b) : undefined, code: CODE[e.code] });
      }
    });

  app.get('/contents/:id', guarded(async (s, req, reply) => {
    try {
      return await showDetail(s, reply, idOf(req));
    } catch (e) {
      if (e instanceof AppError && e.code === 'NOT_FOUND') return html(reply, notFound(s), 404);
      throw e;
    }
  }));

  const draftOf = (b: Record<string, unknown>) => ({ headline: str(b.headline), body: str(b.body), call_to_action: str(b.call_to_action), hashtags: str(b.hashtags) });

  app.post('/contents/:id/edit', action('edited', async (s, id, b) => {
    const tags = str(b.hashtags).split(/\s+/).filter(Boolean);
    await svc.saveEdit(o.db, s.actor, id, Number(b.revision), { headline: str(b.headline), body: str(b.body), call_to_action: str(b.call_to_action), hashtags: tags });
  }, draftOf));

  app.post('/contents/:id/approve', action('approved', async (s, id, b) => {
    const d = await svc.getContent(o.db, s.actor, id);
    const at = fromLocalInput(str(b.scheduled_at), d.item.market);
    if (!at) throw new AppError('INVALID', 'Giờ đăng không hợp lệ');
    await svc.approve(o.db, s.actor, id, { revision: Number(b.revision), packageHash: str(b.package_hash), scheduledAt: at, claimsConfirmed: b.claims_confirmed === '1' }, svcOpts);
  }));

  app.post('/contents/:id/publish', action('published', async (s, id) => {
    if (!o.publisher) throw new AppError('CONFLICT', 'Chưa cấu hình Trang Meta nên không hẹn lên Trang được');
    const d = await svc.getContent(o.db, s.actor, id);
    if (!canReview(s.actor, d.item.market)) throw new AppError('FORBIDDEN', 'Bạn không có quyền hẹn bài thuộc thị trường này');
    const r = await publishOne(o.publisher, id);
    if (r.outcome === 'failed' || r.outcome === 'returned' || r.outcome === 'skipped') throw new AppError('CONFLICT', r.detail);
  }));

  app.post('/contents/:id/request-changes', action('changes', (s, id, b) => svc.requestChanges(o.db, s.actor, id, str(b.note))));
  app.post('/contents/:id/reject', action('rejected', (s, id, b) => svc.reject(o.db, s.actor, id, str(b.note))));
  app.post('/contents/:id/cancel', action('cancelled', async (s, id, b) => {
    const d = await svc.getContent(o.db, s.actor, id);
    if (d.item.state !== 'SCHEDULED') return svc.cancel(o.db, s.actor, id, str(b.note) || undefined);
    // Bài đã hẹn trên Meta: phải xóa bên Meta trước khi hủy trong hệ thống.
    if (!o.publisher) throw new AppError('CONFLICT', 'Chưa cấu hình Trang Meta nên không hủy được bài đã hẹn giờ');
    return cancelScheduled(o.publisher, s.actor, id, str(b.note) || undefined);
  }));

  // --- công tắc tạm dừng (quản trị viên) ---
  app.post('/admin/pause', adminOnly(async (s, req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const pause = str(b.action) === 'pause';
    if (pause && b.confirm !== '1') return html(reply, dashboardView(ctxOf(s), await getStats(o.db, s.actor), await svc.listAudit(o.db, s.actor, 6), visibleMarkets(s.actor), { metaOn: !!o.publisher, geminiOn: !!o.generator, paused: s.paused, isAdmin: true, flash: { kind: 'warn', text: 'Hãy tick xác nhận trước khi bật công tắc tạm dừng.' } }), 422);
    await setPaused(o.db, pause, s.actor.email);
    return reply.redirect(`/?ok=${pause ? 'paused' : 'resumed'}`);
  }));

  // --- quản lý người dùng (quản trị viên) ---
  async function renderUsers(s: Session, reply: FastifyReply, extra: { flash?: Flash; password?: { email: string; value: string } } = {}, code = 200) {
    return html(reply, usersView(ctxOf(s), await listUsers(o.db), { flash: extra.flash, password: extra.password, self: s.actor.email }), code);
  }

  const userErr = (e: unknown): Flash => ({ kind: 'err', text: e instanceof AppError ? e.message : 'Có lỗi, thử lại.' });

  app.get('/users', adminOnly(async (s, req, reply) => {
    const ok = OK_MESSAGES[str((req.query as Record<string, unknown>).ok)];
    return renderUsers(s, reply, ok ? { flash: { kind: 'ok', text: ok } } : {});
  }));

  app.post('/users', adminOnly(async (s, req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const roles = Array.isArray(b.roles) ? (b.roles as unknown[]).map(str) : [str(b.roles)].filter(Boolean);
    try {
      const { password } = await createUser(o.db, { email: str(b.email), name: str(b.name), roles });
      return renderUsers(s, reply, { flash: { kind: 'ok', text: `Đã tạo tài khoản ${str(b.email).trim().toLowerCase()}. Mật khẩu chỉ hiện một lần; hãy gửi cho người dùng qua kênh an toàn.` }, password: { email: str(b.email).trim().toLowerCase(), value: password } });
    } catch (e) {
      return renderUsers(s, reply, { flash: userErr(e) }, e instanceof AppError && e.code === 'CONFLICT' ? 409 : 422);
    }
  }));

  app.post('/users/:email/toggle', adminOnly(async (s, req, reply) => {
    const email = decodeURIComponent((req.params as { email: string }).email);
    const disable = str((req.body as Record<string, unknown>).action) === 'disable';
    try {
      await setDisabled(o.db, email, disable, s.actor.email);
      return renderUsers(s, reply, { flash: { kind: 'ok', text: disable ? `Đã khóa ${email}. Hiệu lực ngay.` : `Đã mở khóa ${email}.` } });
    } catch (e) {
      return renderUsers(s, reply, { flash: userErr(e) }, 422);
    }
  }));

  app.post('/users/:email/reset', adminOnly(async (s, req, reply) => {
    const email = decodeURIComponent((req.params as { email: string }).email);
    try {
      const { password } = await resetPassword(o.db, email);
      return renderUsers(s, reply, { flash: { kind: 'ok', text: `Đã đặt lại mật khẩu cho ${email}. Mật khẩu mới chỉ hiện một lần.` }, password: { email, value: password } });
    } catch (e) {
      return renderUsers(s, reply, { flash: userErr(e) }, 422);
    }
  }));

  // --- kiểm toán ---
  app.get('/audit', guarded(async (s, _req, reply) => html(reply, auditView(ctxOf(s), await svc.listAudit(o.db, s.actor)))));
}

function notFound(_s: unknown): string {
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Không tìm thấy</title><link rel="stylesheet" href="/assets/app.css"><main class="page"><h1>Không tìm thấy bài</h1><p class="muted">Bài không tồn tại hoặc bạn không có quyền xem.</p><p><a href="/queue">Về hàng chờ</a></p></main></html>`;
}

function forbiddenPage(ctx: { user?: { name: string; email: string; roles: string[] }; csrf?: string; pending?: number; paused?: boolean }): string {
  return page({ ...ctx, title: 'Không có quyền' }, h`<div class="page"><h1>Không có quyền</h1><p class="muted">Chức năng này chỉ dành cho quản trị viên.</p></div>`);
}
