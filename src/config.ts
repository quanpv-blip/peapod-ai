import { z } from 'zod';

const base = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().min(1),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type BaseConfig = z.infer<typeof base>;

/** Cấu hình tối thiểu để chạy API/worker. Khóa nhà cung cấp được yêu cầu riêng ở từng bộ chuyển đổi. */
export function loadBaseConfig(env: NodeJS.ProcessEnv = process.env): BaseConfig {
  const parsed = base.safeParse(env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Cấu hình không hợp lệ: ${missing}`);
  }
  return parsed.data;
}

/** Đọc một biến bắt buộc; lỗi nêu rõ tên biến nhưng không in giá trị. */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const v = env[name];
  if (!v) throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  return v;
}
