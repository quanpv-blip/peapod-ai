// Chuẩn hóa bài do AI viết trước khi vào hàng chờ: sửa những lỗi trình bày mô hình hay mắc, không đổi nội dung.
import type { ContentPackage } from './package.ts';

export const MAX_HASHTAGS = 5;

/** Hashtag: bỏ khoảng trắng bên trong, thêm "#" nếu thiếu, bỏ trùng (không phân biệt hoa thường), tối đa 5. */
export function normalizeHashtags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const core = raw.replace(/[\s#＃]+/g, '').replace(/[,.;:!?、。]+$/u, '');
    if (!core) continue;
    const tag = `#${core}`;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_HASHTAGS) break;
  }
  return out;
}

/** Thân bài: bỏ khoảng trắng cuối dòng, gộp nhiều dòng trống liên tiếp thành một. */
export function tidyBody(body: string): string {
  return body.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

export function polishPackage(pkg: ContentPackage): ContentPackage {
  return {
    ...pkg,
    post: {
      headline: pkg.post.headline.trim(),
      body: tidyBody(pkg.post.body),
      call_to_action: pkg.post.call_to_action.trim(),
      hashtags: normalizeHashtags(pkg.post.hashtags),
    },
  };
}
