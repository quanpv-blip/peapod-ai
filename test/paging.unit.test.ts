import { describe, expect, it } from 'vitest';
import { pageInfo, PAGE_SIZE } from '../src/domain/paging.ts';

describe('pageInfo', () => {
  it('không có mục nào: vẫn có đúng một trang', () => {
    expect(pageInfo(undefined, 0)).toMatchObject({ page: 1, pages: 1, offset: 0, total: 0 });
  });
  it('chia đủ trang và tính OFFSET của trang được chọn', () => {
    expect(pageInfo('3', 60, 25)).toMatchObject({ page: 3, pages: 3, offset: 50, size: 25 });
  });
  it('trang vượt quá được kẹp về trang cuối', () => {
    expect(pageInfo('99', 60, 25).page).toBe(3);
  });
  it('số âm, số 0 và chữ rơi về trang 1', () => {
    expect(pageInfo('-4', 60, 25).page).toBe(1);
    expect(pageInfo('0', 60, 25).page).toBe(1);
    expect(pageInfo('abc', 60, 25).page).toBe(1);
  });
  it('kích thước mặc định là PAGE_SIZE', () => {
    expect(pageInfo(undefined, 1).size).toBe(PAGE_SIZE);
  });
});
