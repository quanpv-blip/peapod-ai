// So sánh hai bản nội dung theo dòng (LCS). Dùng cho "so với bản trước" trên trang chi tiết (U-04). Thuần, không I/O.
import type { ContentPackage } from './package.ts';

export type DiffOp = { type: 'eq' | 'add' | 'del'; text: string };

/** Khác biệt theo dòng giữa hai danh sách dòng. Thứ tự giữ nguyên như bản đích. */
export function lineDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  // Bảng LCS (nội dung bài ngắn nên O(n·m) là đủ).
  const t: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!);
    }
  }
  const out: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'eq', text: a[i]! });
      i++;
      j++;
    } else if (t[i + 1]![j]! >= t[i]![j + 1]!) {
      out.push({ type: 'del', text: a[i]! });
      i++;
    } else {
      out.push({ type: 'add', text: b[j]! });
      j++;
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++]! });
  while (j < m) out.push({ type: 'add', text: b[j++]! });
  return out;
}

export interface PackageDiff {
  headline: DiffOp[];
  body: DiffOp[];
  call_to_action: DiffOp[];
  hashtags: DiffOp[];
  changed: boolean;
}

/** So sánh phần nội dung người duyệt có thể sửa: tiêu đề, thân, CTA, hashtag. */
export function diffPackages(prev: ContentPackage, next: ContentPackage): PackageDiff {
  const split = (s: string) => s.split('\n').map((x) => x.trimEnd());
  const headline = lineDiff([prev.post.headline], [next.post.headline]);
  const body = lineDiff(split(prev.post.body), split(next.post.body));
  const call_to_action = lineDiff([prev.post.call_to_action], [next.post.call_to_action]);
  const hashtags = lineDiff([prev.post.hashtags.join(' ')], [next.post.hashtags.join(' ')]);
  const changed = [headline, body, call_to_action, hashtags].some((d) => d.some((x) => x.type !== 'eq'));
  return { headline, body, call_to_action, hashtags, changed };
}
