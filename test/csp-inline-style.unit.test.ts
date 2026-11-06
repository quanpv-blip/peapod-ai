import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// CSP của ứng dụng là `style-src 'self'`: trình duyệt chặn im lặng mọi style="..." nội tuyến, làm hỏng giao diện
// (ví dụ thanh hạn mức bị trống). Dùng lớp CSS (xem UTIL và w0..w100 trong src/web/styles.ts) thay cho style nội tuyến.
const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'web');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

describe('giao diện không dùng style nội tuyến (CSP style-src self)', () => {
  it('không có style="..." trong mã tạo HTML', () => {
    const offenders = sources(webDir).flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ f: path.relative(webDir, f), n: i + 1, line }))
        .filter((x) => /\sstyle="/.test(x.line)),
    );
    expect(offenders.map((x) => `${x.f}:${x.n}`)).toEqual([]);
  });
});
