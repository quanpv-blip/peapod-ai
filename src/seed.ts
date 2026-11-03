// Dữ liệu mẫu cho môi trường local: tài khoản demo + nạp các bài đã sinh ở PoC (poc/out/e2e-*.json) vào hàng chờ duyệt.
// Chạy: npx tsx src/seed.ts   (DATABASE_URL trỏ tới DB local). Không dùng cho production.
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hashPassword, type Role } from './auth.ts';
import { createPool } from './db.ts';
import { packageHash, validatePackage, type ContentPackage } from './domain/package.ts';
import { requireEnv } from './config.ts';

const pool = createPool(requireEnv('DATABASE_URL'));

const USERS: { email: string; name: string; roles: Role[] }[] = [
  { email: 'vn@demo.local', name: 'Người duyệt VN', roles: ['approver_vn'] },
  { email: 'jp@demo.local', name: 'Người duyệt JP', roles: ['approver_jp'] },
  { email: 'admin@demo.local', name: 'Quản trị', roles: ['admin', 'approver_vn'] },
];

for (const u of USERS) {
  const exists = await pool.query('SELECT 1 FROM app_user WHERE email = $1', [u.email]);
  if (exists.rowCount) { console.log(`= ${u.email} đã có (giữ nguyên mật khẩu)`); continue; }
  const pw = randomBytes(9).toString('base64url');
  await pool.query('INSERT INTO app_user(email, display_name, roles, password_hash) VALUES ($1,$2,$3,$4)', [u.email, u.name, u.roles, hashPassword(pw)]);
  console.log(`+ ${u.email}  mật khẩu: ${pw}   (${u.roles.join(', ')})`);
}

const dir = path.resolve('poc', 'out');
for (const f of readdirSync(dir).filter((n) => /^e2e-.*\.json$/.test(n))) {
  const j = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as { raw: unknown; model?: string };
  const v = validatePackage(j.raw);
  if (!v.ok) { console.log(`! ${f}: không hợp lệ, bỏ qua (${v.errors[0]})`); continue; }
  const pkg = v.value;
  const hash = packageHash(pkg);
  const dup = await pool.query('SELECT 1 FROM content_revision WHERE package_hash = $1', [hash]);
  if (dup.rowCount) { console.log(`= ${f} đã nạp`); continue; }
  const engine = pkg.media.engine;
  const format = engine === 'NONE' ? 'TEXT' : engine === 'REMOTION_CARD' ? 'IMAGE' : 'REEL';
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const it = await c.query<{ id: number }>(
      `INSERT INTO content_item(market, page_key, format, media_engine, state) VALUES ($1,$2,$3,$4,'IN_REVIEW') RETURNING id`, [pkg.market, pkg.market, format, engine]);
    await c.query('INSERT INTO content_revision(content_id, revision, package, package_hash, model) VALUES ($1,1,$2,$3,$4)', [it.rows[0]!.id, JSON.stringify(pkg), hash, j.model ?? null]);
    await c.query('COMMIT');
    console.log(`+ ${f} -> bài #${it.rows[0]!.id} (${pkg.market}, chờ duyệt)`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

// --demo: bộ bài mẫu đủ trạng thái và lịch sử 7 ngày để xem giao diện. Tiêu đề gắn "[Mẫu]"; chỉ dùng cho local.
if (process.argv.includes('--demo')) {
  const bases = readdirSync(dir).filter((n) => /^e2e-.*\.json$/.test(n)).map((n) => (JSON.parse(readFileSync(path.join(dir, n), 'utf8')) as { raw: ContentPackage }).raw);
  const H = 3_600_000;
  const plan: { st: string; ageH: number; schedH?: number; ev: [string, string, number][] }[] = [
    { st: 'IN_REVIEW', ageH: 30, ev: [] }, { st: 'IN_REVIEW', ageH: 9, ev: [] }, { st: 'IN_REVIEW', ageH: 3, ev: [['EDIT', 'vn@demo.local', 2]] }, { st: 'IN_REVIEW', ageH: 1, ev: [] },
    { st: 'CHANGES_REQUESTED', ageH: 20, ev: [['REQUEST_CHANGES', 'vn@demo.local', 20]] },
    { st: 'SCHEDULED', ageH: 40, schedH: 20, ev: [['APPROVE', 'vn@demo.local', 40]] }, { st: 'SCHEDULED', ageH: 30, schedH: 52, ev: [['APPROVE', 'jp@demo.local', 30]] },
    { st: 'APPROVED', ageH: 10, schedH: 76, ev: [['APPROVE', 'vn@demo.local', 10]] },
    { st: 'PUBLISHED', ageH: 100, ev: [['APPROVE', 'vn@demo.local', 100]] }, { st: 'PUBLISHED', ageH: 130, ev: [['EDIT', 'jp@demo.local', 140], ['APPROVE', 'jp@demo.local', 130]] },
    { st: 'REJECTED', ageH: 60, ev: [['REJECT', 'vn@demo.local', 60]] }, { st: 'CANCELLED', ageH: 70, ev: [['APPROVE', 'vn@demo.local', 80], ['CANCEL', 'admin@demo.local', 70]] },
  ];
  let n = 0;
  for (const p of plan) {
    const base = bases[n % bases.length]!;
    const pkg: ContentPackage = { ...base, post: { ...base.post, headline: `[Mẫu ${n + 1}] ${base.post.headline}`.slice(0, 120) } };
    const hash = packageHash(pkg);
    if ((await pool.query('SELECT 1 FROM content_revision WHERE package_hash = $1', [hash])).rowCount) { n++; continue; }
    const at = new Date(Date.now() - p.ageH * H);
    const it = await pool.query('INSERT INTO content_item(market, page_key, format, media_engine, state, scheduled_at, created_at, updated_at) VALUES ($1,$1,$2,$3,$4,$5,$6,$6) RETURNING id', [pkg.market, pkg.media.engine === 'NONE' ? 'TEXT' : 'IMAGE', pkg.media.engine, p.st, p.schedH ? new Date(Date.now() + p.schedH * H) : null, at]);
    const id = it.rows[0].id;
    await pool.query('INSERT INTO content_revision(content_id, revision, package, package_hash, model, created_at) VALUES ($1,1,$2,$3,$4,$5)', [id, JSON.stringify(pkg), hash, 'gemini-3.6-flash', at]);
    for (const [action, actor, hAgo] of p.ev) await pool.query('INSERT INTO approval_event(content_id, revision, package_hash, actor, action, created_at) VALUES ($1,1,$2,$3,$4,$5)', [id, hash, actor, action, new Date(Date.now() - hAgo * H)]);
    n++;
  }
  console.log('+ đã nạp bộ bài mẫu (--demo)');
}
await pool.end();
