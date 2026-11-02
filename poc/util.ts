import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Nạp .env nếu có (Node >= 22). Không in giá trị. */
export function loadEnv(): void {
  if (existsSync('.env')) process.loadEnvFile('.env');
}

export function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  if (v !== undefined && !v.startsWith('--')) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Thiếu tham số --${name}`);
}

export function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Ghi bằng chứng thô vào poc/out/ (đã gitignore). Dán kết luận vào ba-team/docs/99-evidence-log.md. */
export function saveEvidence(file: string, data: unknown): string {
  mkdirSync('poc/out', { recursive: true });
  const p = path.join('poc/out', file);
  writeFileSync(p, typeof data === 'string' || data instanceof Uint8Array ? data : JSON.stringify(data, null, 2));
  return p;
}
