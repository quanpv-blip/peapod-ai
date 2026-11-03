// Quản lý tài khoản người duyệt (U-02). Mật khẩu chỉ hiện một lần khi tạo hoặc đặt lại; không lưu dạng rõ.
import { randomBytes } from 'node:crypto';
import type pg from 'pg';
import { hashPassword, type Role } from '../auth.ts';
import { AppError } from './contents.ts';

export const ROLES: Role[] = ['approver_vn', 'approver_jp', 'admin', 'viewer'];

export interface UserRow {
  email: string;
  display_name: string;
  roles: Role[];
  disabled: boolean;
  created_at: Date;
}

export async function listUsers(db: pg.Pool): Promise<UserRow[]> {
  return (await db.query<UserRow>('SELECT email, display_name, roles, disabled, created_at FROM app_user ORDER BY created_at')).rows;
}

const newPassword = () => randomBytes(9).toString('base64url');
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createUser(db: pg.Pool, input: { email: string; name: string; roles: string[] }): Promise<{ password: string }> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) throw new AppError('INVALID', 'Email không hợp lệ');
  if (!input.name.trim()) throw new AppError('INVALID', 'Cần nhập tên hiển thị');
  const roles = input.roles.filter((r): r is Role => (ROLES as string[]).includes(r));
  if (roles.length === 0) throw new AppError('INVALID', 'Chọn ít nhất một vai trò');
  const password = newPassword();
  try {
    await db.query('INSERT INTO app_user(email, display_name, roles, password_hash) VALUES ($1,$2,$3,$4)', [email, input.name.trim(), roles, hashPassword(password)]);
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new AppError('CONFLICT', 'Email này đã có tài khoản');
    throw e;
  }
  return { password };
}

export async function setDisabled(db: pg.Pool, email: string, disabled: boolean, by: string): Promise<void> {
  if (email === by && disabled) throw new AppError('INVALID', 'Không thể tự khóa tài khoản đang đăng nhập');
  const r = await db.query('UPDATE app_user SET disabled = $2 WHERE email = $1', [email, disabled]);
  if (r.rowCount === 0) throw new AppError('NOT_FOUND', 'Không tìm thấy tài khoản');
}

export async function resetPassword(db: pg.Pool, email: string): Promise<{ password: string }> {
  const password = newPassword();
  const r = await db.query('UPDATE app_user SET password_hash = $2 WHERE email = $1', [email, hashPassword(password)]);
  if (r.rowCount === 0) throw new AppError('NOT_FOUND', 'Không tìm thấy tài khoản');
  return { password };
}
