import { describe, expect, it } from 'vitest';
import { canCancel, canReview, checkCsrf, csrfToken, hashPassword, signSession, verifyPassword, verifySession, visibleMarkets, type Actor } from '../src/auth.ts';
import { fromLocalInput, toLocalInput } from '../src/domain/schedule.ts';
import { esc, html } from '../src/web/html.ts';

const SECRET = 'x'.repeat(40);
const actor = (...roles: Actor['roles']): Actor => ({ email: 'a@x.vn', name: 'A', roles });

describe('mật khẩu', () => {
  it('đúng/sai, mỗi lần băm có muối khác nhau', () => {
    const h = hashPassword('correct horse');
    expect(verifyPassword('correct horse', h)).toBe(true);
    expect(verifyPassword('wrong', h)).toBe(false);
    expect(hashPassword('correct horse')).not.toBe(h);
  });
  it('chuỗi băm hỏng không làm sập', () => {
    expect(verifyPassword('x', 'scrypt$00$00')).toBe(false);
    expect(verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('phiên và CSRF', () => {
  it('token hợp lệ, hết hạn, bị sửa, sai khóa', () => {
    const t = signSession({ email: 'a@x.vn' }, SECRET, 60, 1_000_000);
    expect(verifySession(t, SECRET, 1_000_000 + 30_000)?.email).toBe('a@x.vn');
    expect(verifySession(t, SECRET, 1_000_000 + 61_000)).toBeNull();
    expect(verifySession(t + 'a', SECRET, 1_000_000)).toBeNull();
    expect(verifySession(t, 'y'.repeat(40), 1_000_000)).toBeNull();
    expect(verifySession(undefined, SECRET)).toBeNull();
  });
  it('CSRF gắn với phiên', () => {
    const c = csrfToken('sid1', SECRET);
    expect(checkCsrf(c, 'sid1', SECRET)).toBe(true);
    expect(checkCsrf(c, 'sid2', SECRET)).toBe(false);
    expect(checkCsrf(undefined, 'sid1', SECRET)).toBe(false);
    expect(checkCsrf('', 'sid1', SECRET)).toBe(false);
  });
});

describe('phân quyền theo thị trường', () => {
  it('người duyệt chỉ thấy và duyệt thị trường của mình', () => {
    expect(visibleMarkets(actor('approver_vn'))).toEqual(['VN']);
    expect(canReview(actor('approver_vn'), 'JP')).toBe(false);
    expect(canReview(actor('approver_jp'), 'JP')).toBe(true);
  });
  it('admin thấy cả hai, hủy được nhưng không duyệt thay (D-15)', () => {
    const a = actor('admin');
    expect(visibleMarkets(a)).toEqual(['VN', 'JP']);
    expect(canReview(a, 'VN')).toBe(false);
    expect(canCancel(a, 'JP')).toBe(true);
  });
  it('viewer chỉ xem', () => {
    const v = actor('viewer');
    expect(visibleMarkets(v)).toEqual(['VN', 'JP']);
    expect(canReview(v, 'VN')).toBe(false);
    expect(canCancel(v, 'VN')).toBe(false);
  });
});

describe('HTML an toàn', () => {
  it('escape dữ liệu không tin cậy', () => {
    expect(esc(`<script>alert("x")</script>'&`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&#39;&amp;');
    const evil = '"><img src=x onerror=alert(1)>';
    expect(html`<input value="${evil}">`.html).toBe('<input value="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;">');
  });
  it('Safe và mảng Safe không bị escape hai lần', () => {
    const inner = html`<b>${'<i>'}</b>`;
    expect(html`<p>${inner}</p>`.html).toBe('<p><b>&lt;i&gt;</b></p>');
    expect(html`<ul>${['a', 'b'].map((x) => html`<li>${x}</li>`)}</ul>`.html).toBe('<ul><li>a</li><li>b</li></ul>');
  });
});

describe('giờ đăng theo ô datetime-local', () => {
  it('đổi qua lại theo múi giờ thị trường', () => {
    const utc = fromLocalInput('2030-01-01T12:00', 'JP')!;
    expect(utc.toISOString()).toBe('2030-01-01T03:00:00.000Z');
    expect(toLocalInput(utc, 'JP')).toBe('2030-01-01T12:00');
    expect(fromLocalInput('2030-01-01T12:00', 'VN')!.toISOString()).toBe('2030-01-01T05:00:00.000Z');
  });
  it('từ chối đầu vào sai', () => {
    expect(fromLocalInput('2030-02-31T10:00', 'VN')).toBeNull();
    expect(fromLocalInput('abc', 'VN')).toBeNull();
    expect(fromLocalInput('2030-01-01T25:00', 'VN')).toBeNull();
  });
});
