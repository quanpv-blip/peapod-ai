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
import { generateCampaign, generateNews, generateTopic } from '../services/generate.ts';
import { isPaused, setPaused } from '../services/settings.ts';
import { createUser, listUsers, resetPassword, setDisabled } from '../services/users.ts';
import { getAppSettings, saveAppSettings } from '../services/appSettings.ts';
import { costSummary } from '../services/costs.ts';
import { changeOwnPassword } from '../services/account.ts';
import { diffPackages } from '../domain/diff.ts';
import { pageInfo, PAGE_SIZE } from '../domain/paging.ts';
import { notifyAll } from '../services/alerts.ts';
import { remoteCardConfigFromEnv, renderReelRemote } from '../media/remote-card.ts';
import { latestReelPath, reelStatus, startReelJob } from '../services/reels.ts';
import { readFile } from 'node:fs/promises';
import { settingsPage } from './views/settings.ts';
import { costsPage } from './views/costs.ts';
import { campaignPage } from './views/campaign.ts';
import { createPage } from './views/create.ts';
import { quotaPage } from './views/quota.ts';
import { quotaReport } from '../services/quota.ts';
import { recentItems } from '../services/sources.ts';
import { suggestTopics } from '../services/topics.ts';
import { accountPage } from './views/account.ts';
import { page, type Flash } from './layout.ts';
import { html as h } from './html.ts';
import { CSS } from './styles.ts';
import { THEME_JS } from './theme.ts';
import { LOGO_SVG, LOGIN_BG_SVG, SIDE_BG_SVG } from './assets.ts';
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
  generator?: { gemini: GeminiClient; schema: object; mediaDir: string; model: string };
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
  'alert-sent': 'Đã gửi tin thử tới kênh cảnh báo. Kiểm tra nhóm Telegram hoặc kênh Slack.',
  'alert-none': 'Chưa có kênh cảnh báo nào được cấu hình. Đặt TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID hoặc SLACK_WEBHOOK_URL trong file .env.',
  'reel-started': 'Đang dựng video 9:16, thường mất 10–60 giây. Tải lại trang sau ít phút.',
  'reel-busy': 'Video của bài này đang được dựng. Chờ xong rồi tải lại trang.',
  'reel-off': 'Chưa bật dịch vụ Remotion (REMOTION_RENDER_URL) nên không dựng được video.',
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

  // Lỗi bất ngờ: trang HTML thân thiện thay cho JSON 500; chi tiết chỉ ghi vào nhật ký máy chủ.
  app.setErrorHandler((err: Error, req, reply) => {
    app.log.error({ err: err.message, url: req.url }, 'lỗi xử lý yêu cầu');
    if (reply.sent) return;
    if (!String(req.headers.accept ?? '').includes('text/html')) return reply.code(500).send({ error: 'Có lỗi tạm thời, thử lại sau' });
    return reply.code(500).type('text/html; charset=utf-8').send(
      page({ title: 'Có lỗi' }, h`<div class="page"><h1>Có lỗi tạm thời</h1><p class="muted">Hệ thống chưa xử lý được yêu cầu này. Thử lại sau ít phút. Nếu vẫn lỗi, báo quản trị viên kèm thời điểm này.</p><p><a href="/">Về tổng quan</a></p></div>`),
    );
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; media-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
    if (!reply.hasHeader('Cache-Control')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  app.get('/assets/app.css', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=300').type('text/css; charset=utf-8').send(CSS));
  app.get('/assets/logo.svg', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=86400').type('image/svg+xml; charset=utf-8').send(LOGO_SVG));
  app.get('/assets/login-bg.svg', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=86400').type('image/svg+xml; charset=utf-8').send(LOGIN_BG_SVG));
  app.get('/assets/side-bg.svg', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=86400').type('image/svg+xml; charset=utf-8').send(SIDE_BG_SVG));
  app.get('/assets/theme.js', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=300').type('application/javascript; charset=utf-8').send(THEME_JS));

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
    const page = pageInfo(query.page, await svc.countContents(o.db, s.actor, filter), PAGE_SIZE);
    const rows = await svc.listContents(o.db, s.actor, { ...filter, limit: page.size, offset: page.offset });
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
      ctx: ctxOf(s), rows, info, counts, now: new Date(), filter, page, markets, flash,
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
    const results = await generateNews({ db: o.db, gemini: o.generator.gemini, schema: o.generator.schema, mediaDir: o.generator.mediaDir }, { market, limit, model: o.generator.model });
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
    const settings = await getAppSettings(o.db);
    const slot = nextBusinessSlot(d.item.market, settings.defaultPostTime[d.item.market] ?? DEFAULT_LOCAL_TIME[d.item.market]);
    // So sánh với bản trước (U-04): chỉ khi có từ hai revision trở lên.
    let changes: ReturnType<typeof diffPackages> | undefined;
    if (d.item.current_revision > 1) {
      const prev = await o.db.query<{ package: unknown }>('SELECT package FROM content_revision WHERE content_id = $1 AND revision = $2', [id, d.item.current_revision - 1]);
      if (prev.rows[0]) changes = diffPackages(prev.rows[0].package as typeof d.package, d.package);
    }
    const card = await o.db.query("SELECT 1 FROM media_asset WHERE content_id = $1 AND revision = $2 AND kind = 'IMAGE'", [id, d.item.current_revision]);
    return html(reply, detailView({
      ctx: ctxOf(s), d, csrf: s.csrf,
      can: { review: canReview(s.actor, d.item.market), cancel: canCancel(s.actor, d.item.market) },
      blockedByFourEyes: svcOpts.fourEyesMarkets.includes(d.item.market) && d.editedBy === s.actor.email,
      scheduleDefault: toLocalInput(d.item.scheduled_at ?? slot, d.item.market),
      canPublish: !!o.publisher && canReview(s.actor, d.item.market) && d.item.state === 'APPROVED',
      fbUrl: d.item.fb_post_id ? `https://www.facebook.com/${d.item.fb_post_id}` : undefined,
      hasCard: (card.rowCount ?? 0) > 0,
      reel: {
        status: await reelStatus(o.db, id),
        hasVideo: !!(await latestReelPath(o.db, id, d.item.current_revision)),
        configured: !!remoteCardConfigFromEnv(),
        canGenerate: canReview(s.actor, d.item.market),
      },
      changes,
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
      const okMsg = OK_MESSAGES[str((req.query as Record<string, unknown>).ok)];
      return await showDetail(s, reply, idOf(req), okMsg ? { flash: { kind: 'ok', text: okMsg } } : {});
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
    void notifyAll(pause ? `⏸️ ${s.actor.name} đã BẬT công tắc tạm dừng PeaPod` : `▶️ ${s.actor.name} đã TẮT công tắc tạm dừng PeaPod`);
    return reply.redirect(`/?ok=${pause ? 'paused' : 'resumed'}`);
  }));

  // Gửi một tin thử tới mọi kênh cảnh báo đã cấu hình, để kiểm tra Slack/Telegram sau khi đặt biến môi trường.
  app.post('/admin/alert-test', adminOnly(async (s, _req, reply) => {
    const r = await notifyAll(`🔔 Kiểm thử cảnh báo PeaPod, gửi bởi ${s.actor.name}. Có thể bỏ qua.`);
    return reply.redirect(`/?ok=${r.slack || r.telegram ? 'alert-sent' : 'alert-none'}`);
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

  // --- tạo bài viết mới: đề xuất chủ đề, rồi AI viết từ tin trong kho ---
  const createMarkets = (s: Session): Market[] => visibleMarkets(s.actor).filter((m) => canReview(s.actor, m));
  const pickMarket = (markets: Market[], raw: unknown): Market => {
    const m = str(raw).toUpperCase() as Market;
    return markets.includes(m) ? m : (markets[0] ?? 'VN');
  };

  app.get('/create', guarded(async (s, req, reply) => {
    const markets = createMarkets(s);
    const market = pickMarket(markets, (req.query as Record<string, unknown>).market);
    const recent = await recentItems(o.db, market, new Date(), 3, 30);
    return html(reply, createPage(ctxOf(s), { markets, market, recent, aiOn: !!o.generator }));
  }));

  app.post('/create/suggest', guarded(async (s, req, reply) => {
    const markets = createMarkets(s);
    const market = pickMarket(markets, (req.body as Record<string, unknown>).market);
    if (markets.length === 0) return html(reply, createPage(ctxOf(s), { markets, market, recent: [], aiOn: !!o.generator, flash: { kind: 'err', text: 'Bạn chưa có quyền duyệt thị trường nào.' } }), 403);
    const suggest = await suggestTopics({ db: o.db, gemini: o.generator?.gemini, model: o.generator?.model ?? 'gemini-3.6-flash' }, market);
    const recent = await recentItems(o.db, market, new Date(), 3, 30);
    return html(reply, createPage(ctxOf(s), { markets, market, recent, suggest, aiOn: !!o.generator }));
  }));

  app.post('/create/generate', guarded(async (s, req, reply) => {
    const markets = createMarkets(s);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const market = pickMarket(markets, b.market);
    const topic = str(b.topic).trim();
    const urls = (Array.isArray(b.urls) ? b.urls : [b.urls]).map(str).filter(Boolean);
    const fail = async (text: string, code = 422) => {
      const recent = await recentItems(o.db, market, new Date(), 3, 30);
      return html(reply, createPage(ctxOf(s), { markets, market, recent, aiOn: !!o.generator, topic, flash: { kind: 'err', text } }), code);
    };
    if (!o.generator) return fail('Chưa cấu hình khóa Gemini (GEMINI_API_KEY) nên chưa viết được bài.');
    if (!markets.includes(str(b.market).toUpperCase() as Market)) return fail('Bạn không có quyền tạo bài cho thị trường này.', 403);
    if (!topic) return fail('Cần nhập chủ đề.');
    const r = await generateTopic(
      { db: o.db, gemini: o.generator.gemini, schema: o.generator.schema, mediaDir: o.generator.mediaDir },
      { market, topic, urls: urls.length ? urls : undefined, model: o.generator.model },
    );
    if (r.outcome === 'created') return reply.redirect(`/contents/${r.id}`);
    return fail(r.outcome === 'error' ? `Lỗi khi gọi AI: ${r.detail}` : r.detail);
  }));

  // --- video Reels 9:16 của bài (dựng qua dịch vụ Remotion, chạy nền) ---
  const reelDeps = () => ({ db: o.db, mediaDir: process.env.MEDIA_DIR ?? './media', renderReel: (input: Parameters<typeof renderReelRemote>[0]) => renderReelRemote(input, remoteCardConfigFromEnv()!) });
  app.post('/contents/:id/reel', guarded(async (s, req, reply) => {
    const id = idOf(req);
    const d = await svc.getContent(o.db, s.actor, id);
    if (!canReview(s.actor, d.item.market)) throw new AppError('FORBIDDEN', 'Bạn không có quyền dựng video cho thị trường này');
    if (!remoteCardConfigFromEnv()) return reply.redirect(`/contents/${id}?ok=reel-off`);
    if ((await reelStatus(o.db, id))?.state === 'pending') return reply.redirect(`/contents/${id}?ok=reel-busy`);
    startReelJob(reelDeps(), id, d.item.current_revision, d.package);
    return reply.redirect(`/contents/${id}?ok=reel-started`);
  }));
  app.get('/contents/:id/reel', guarded(async (s, req, reply) => {
    const id = idOf(req);
    const d = await svc.getContent(o.db, s.actor, id);
    const file = await latestReelPath(o.db, id, d.item.current_revision);
    if (!file) return reply.code(404).type('text/plain; charset=utf-8').send('Chưa có video');
    return reply.header('Cache-Control', 'private, max-age=60').type('video/mp4').send(await readFile(file));
  }));

  // --- ảnh thẻ của bài (E6) ---
  app.get('/contents/:id/card', guarded(async (s, req, reply) => {
    try {
      const d = await svc.getContent(o.db, s.actor, idOf(req));
      const a = await o.db.query<{ path: string }>("SELECT path FROM media_asset WHERE content_id = $1 AND revision = $2 AND kind = 'IMAGE' ORDER BY id DESC LIMIT 1", [d.item.id, d.item.current_revision]);
      if (!a.rows[0]) return reply.code(404).type('text/plain; charset=utf-8').send('Chưa có ảnh thẻ');
      return reply.header('Cache-Control', 'private, max-age=60').type('image/png').send(await readFile(a.rows[0].path));
    } catch (e) {
      if (e instanceof AppError) return reply.code(404).send('Không tìm thấy');
      throw e;
    }
  }));

  // --- cài đặt vận hành (quản trị viên) ---
  app.get('/settings', adminOnly(async (s, req, reply) => {
    const ok = str((req.query as Record<string, unknown>).ok) === '1';
    return html(reply, settingsPage(ctxOf(s), { settings: await getAppSettings(o.db), saved: ok }));
  }));

  app.post('/settings', adminOnly(async (s, req, reply) => {
    const form = (req.body ?? {}) as Record<string, unknown>;
    const r = await saveAppSettings(o.db, form, s.actor.email);
    if (!r.ok) return html(reply, settingsPage(ctxOf(s), { form: form as Record<string, string>, errors: r.errors }), 422);
    return reply.redirect('/settings?ok=1');
  }));

  // --- chi phí AI (quản trị viên) ---
  app.get('/costs', adminOnly(async (s, req, reply) => {
    const [sum, settings] = await Promise.all([costSummary(o.db, new Date(), (req.query as Record<string, unknown>).page), getAppSettings(o.db)]);
    return html(reply, costsPage(ctxOf(s), { sum, settings }));
  }));

  // --- bài chiến dịch theo chủ đề ---
  app.get('/campaign', guarded(async (s, _req, reply) => {
    const markets = visibleMarkets(s.actor).filter((m) => canReview(s.actor, m));
    return reply.redirect('/create');
  }));

  app.post('/campaign', guarded(async (s, req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const market = str(b.market).toUpperCase() as Market;
    const markets = visibleMarkets(s.actor).filter((m) => canReview(s.actor, m));
    const domains = (await getAppSettings(o.db)).campaignDomains;
    const form = { market, topic: str(b.topic), sourceUrl: str(b.sourceUrl), sourceText: str(b.sourceText), note: str(b.note) };
    const fail = (text: string) => html(reply, campaignPage(ctxOf(s), { markets, domains, aiOn: !!o.generator, form, flash: { kind: 'err', text } }), 422);
    if (!o.generator) return fail('Chưa cấu hình khóa Gemini (GEMINI_API_KEY) nên không tạo được bài.');
    if (!markets.includes(market)) return fail('Bạn không có quyền tạo bài cho thị trường này.');
    if (!form.topic.trim()) return fail('Cần nhập chủ đề.');
    const r = await generateCampaign(
      { db: o.db, gemini: o.generator.gemini, schema: o.generator.schema, mediaDir: o.generator.mediaDir },
      { market, topic: form.topic.trim().slice(0, 60), sourceUrl: form.sourceUrl.trim(), sourceText: form.sourceText, note: form.note, model: o.generator.model },
    );
    if (r.outcome === 'created') return reply.redirect(`/contents/${r.id}`);
    return fail(r.outcome === 'error' ? `Lỗi khi gọi AI: ${r.detail}` : r.detail);
  }));

  // --- tài khoản của chính mình ---
  app.get('/account', guarded(async (s, _req, reply) => html(reply, accountPage(ctxOf(s)))));

  app.post('/account/password', guarded(async (s, req, reply) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (str(b.next) !== str(b.confirm)) return html(reply, accountPage(ctxOf(s), { flash: { kind: 'err', text: 'Mật khẩu xác nhận không khớp.' } }), 422);
    try {
      await changeOwnPassword(o.db, s.actor.email, str(b.current), str(b.next));
      return html(reply, accountPage(ctxOf(s), { flash: { kind: 'ok', text: 'Đã đổi mật khẩu. Lần đăng nhập sau dùng mật khẩu mới.' } }));
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
      return html(reply, accountPage(ctxOf(s), { flash: { kind: 'err', text: e.message } }), 422);
    }
  }));

  // --- xuất nhật ký kiểm toán (CSV, có BOM để Excel đọc tiếng Việt) ---
  app.get('/audit.csv', guarded(async (s, _req, reply) => {
    const rows = await svc.listAudit(o.db, s.actor, 1000);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['thoi_diem', 'nguoi_thuc_hien', 'thao_tac', 'bai', 'ban', 'thi_truong', 'ghi_chu'];
    const body = rows.map((r) => [new Date(r.created_at).toISOString(), r.actor, r.action, r.content_id, r.revision, r.market, r.note].map(esc).join(','));
    return reply
      .header('Content-Disposition', 'attachment; filename="nhat-ky-kiem-toan.csv"')
      .type('text/csv; charset=utf-8')
      .send(`﻿${[head.join(','), ...body].join('\r\n')}\r\n`);
  }));

  // --- hạn mức, credit và giới hạn đăng ---
  app.get('/quota', guarded(async (s, _req, reply) => {
    const report = await quotaReport(o.db, await getAppSettings(o.db), { metaConfigured: !!o.publisher });
    return html(reply, quotaPage(ctxOf(s), report));
  }));

  // --- kiểm toán ---
  app.get('/audit', guarded(async (s, req, reply) => {
    const page = pageInfo((req.query as Record<string, unknown>).page, await svc.countAudit(o.db, s.actor), 50);
    return html(reply, auditView(ctxOf(s), await svc.listAudit(o.db, s.actor, page.size, page.offset), page));
  }));
}

function notFound(_s: unknown): string {
  return `<!doctype html><html lang="vi"><meta charset="utf-8"><title>Không tìm thấy</title><link rel="stylesheet" href="/assets/app.css"><main class="page"><h1>Không tìm thấy bài</h1><p class="muted">Bài không tồn tại hoặc bạn không có quyền xem.</p><p><a href="/queue">Về hàng chờ</a></p></main></html>`;
}

function forbiddenPage(ctx: { user?: { name: string; email: string; roles: string[] }; csrf?: string; pending?: number; paused?: boolean }): string {
  return page({ ...ctx, title: 'Không có quyền' }, h`<div class="page"><h1>Không có quyền</h1><p class="muted">Chức năng này chỉ dành cho quản trị viên.</p></div>`);
}
