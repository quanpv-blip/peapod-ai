import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Market } from './domain/package.ts';

export type Role = 'approver_vn' | 'approver_jp' | 'admin' | 'viewer';

export interface Actor {
  email: string;
  name: string;
  roles: Role[];
}

// --- Mật khẩu: scrypt (có sẵn trong Node, không thêm phụ thuộc) ---
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

// --- Phiên: token có chữ ký HMAC, hết hạn; không lưu trạng thái phía máy chủ ---
const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function signSession(payload: { email: string }, secret: string, ttlSec: number, now = Date.now()): string {
  const body = b64(JSON.stringify({ email: payload.email, exp: Math.floor(now / 1000) + ttlSec }));
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token: string | undefined, secret: string, now = Date.now()): { email: string } | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { email?: string; exp?: number };
    if (!p.email || !p.exp || p.exp * 1000 < now) return null;
    return { email: p.email };
  } catch {
    return null;
  }
}

/** Token CSRF gắn với phiên: mọi POST phải gửi kèm (kết hợp SameSite=Lax). */
export function csrfToken(sessionToken: string, secret: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionToken}`).digest('base64url');
}

export function checkCsrf(given: string | undefined, sessionToken: string, secret: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(csrfToken(sessionToken, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Phân quyền theo thị trường (docs/10 mục 1) ---
export function visibleMarkets(a: Actor): Market[] {
  if (a.roles.includes('admin') || a.roles.includes('viewer')) return ['VN', 'JP'];
  const m: Market[] = [];
  if (a.roles.includes('approver_vn')) m.push('VN');
  if (a.roles.includes('approver_jp')) m.push('JP');
  return m;
}

export function canReview(a: Actor, market: Market): boolean {
  return a.roles.includes(market === 'VN' ? 'approver_vn' : 'approver_jp');
}

/** Hủy: người duyệt đúng thị trường hoặc admin (admin không duyệt thay, D-15). */
export function canCancel(a: Actor, market: Market): boolean {
  return a.roles.includes('admin') || canReview(a, market);
}
