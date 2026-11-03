import { describe, expect, it } from 'vitest';
import { pager } from '../src/web/components.ts';
import { pageInfo } from '../src/domain/paging.ts';

const href = (n: number) => `/audit?page=${n}`;

describe('thanh phân trang', () => {
  it('chỉ có một trang thì không hiển thị gì', () => {
    expect(String(pager(pageInfo(undefined, 10), href))).toBe('');
  });
  it('trang giữa: có liên kết cả Trước và Sau, nhãn trang đúng', () => {
    const out = String(pager(pageInfo('2', 80, 25), href));
    expect(out).toContain('href="/audit?page=1"');
    expect(out).toContain('href="/audit?page=3"');
    expect(out).toContain('Trang 2 / 4');
    expect(out).not.toContain('aria-disabled="true">‹ Trước');
  });
  it('trang đầu: nút Trước bị vô hiệu hóa, không có liên kết', () => {
    const out = String(pager(pageInfo(undefined, 80, 25), href));
    expect(out).toContain('aria-disabled="true">‹ Trước');
    expect(out).not.toContain('page=0');
  });
  it('trang cuối: nút Sau bị vô hiệu hóa', () => {
    const out = String(pager(pageInfo('4', 80, 25), href));
    expect(out).toContain('aria-disabled="true">Sau ›');
  });
});
