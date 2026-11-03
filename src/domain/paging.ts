// Phân trang thuần cho danh sách: tính số trang và trang hiện tại từ tham số trên URL. Không I/O.

export const PAGE_SIZE = 25;

export interface Page {
  /** Trang hiện tại, từ 1 đến `pages`. */
  page: number;
  /** Tổng số trang, tối thiểu 1 kể cả khi không có mục nào. */
  pages: number;
  size: number;
  /** Vị trí bắt đầu (OFFSET) của trang hiện tại. */
  offset: number;
  total: number;
}

/** Đọc `?page=` và kẹp về khoảng hợp lệ; giá trị lạ (chữ, số âm, quá lớn) rơi về trang gần nhất hợp lệ. */
export function pageInfo(raw: unknown, total: number, size = PAGE_SIZE): Page {
  const pages = Math.max(1, Math.ceil(total / size));
  const n = Number.parseInt(String(raw ?? '1'), 10);
  const page = Number.isFinite(n) ? Math.min(Math.max(1, n), pages) : 1;
  return { page, pages, size, offset: (page - 1) * size, total };
}
