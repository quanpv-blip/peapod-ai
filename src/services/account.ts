// Đổi mật khẩu của chính người đăng nhập. Cần nhập mật khẩu hiện tại; mật khẩu mới được băm, không lưu dạng rõ.
import type pg from 'pg';
import { hashPassword, verifyPassword } from '../auth.ts';
import { AppError } from './contents.ts';

export const MIN_PASSWORD = 10;

export async function changeOwnPassword(db: pg.Pool, email: string, current: string, next: string): Promise<void> {
  if (next.length < MIN_PASSWORD) throw new AppError('INVALID', `Mật khẩu mới cần ít nhất ${MIN_PASSWORD} ký tự`);
  if (next === current) throw new AppError('INVALID', 'Mật khẩu mới phải khác mật khẩu hiện tại');
  const r = await db.query<{ password_hash: string }>('SELECT password_hash FROM app_user WHERE email = $1', [email]);
  const row = r.rows[0];
  if (!row || !verifyPassword(current, row.password_hash)) throw new AppError('INVALID', 'Mật khẩu hiện tại không đúng');
  await db.query('UPDATE app_user SET password_hash = $2 WHERE email = $1', [email, hashPassword(next)]);
}
