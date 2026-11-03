// Điều kiện tự duyệt bài VN (quyết định của Sponsor: chỉ VN, chỉ nguồn RSS/Atom công khai). Thuần, không I/O.
// Mọi điều kiện phải đạt. Thiếu một điều kiện thì bài chờ người duyệt như bình thường.
import { campaignSourceAllowed } from './appSettings.ts';
import type { ContentPackage } from './package.ts';

// Từ khóa tin sự cố bảo mật. Các tin này thường nêu tên công ty và cần người đọc từng câu, nên không tự duyệt.
const INCIDENT = /不正アクセス|情報漏洩|漏えい|漏洩|流出|脆弱性|ランサム|サイバー攻撃|rò rỉ|lộ dữ liệu|tấn công mạng|hacker|mã độc|lừa đảo|sự cố bảo mật|tấn công/i;

export function isIncidentText(s: string): boolean {
  return INCIDENT.test(s);
}

export type AutoCheck = { ok: true } | { ok: false; reason: string };

export interface AutoContext {
  /** Bài có ảnh thẻ cho bản hiện tại (bắt buộc khi media là REMOTION_CARD). */
  hasImage: boolean;
  /** Bài đã có người sửa tay (edited_by khác rỗng): người đã đọc, không tự duyệt tiếp. */
  editedByHuman: boolean;
  /** Tên miền các nguồn RSS VN đã cấu hình. */
  feedDomains: string[];
}

export function autoApproveCheck(p: ContentPackage, c: AutoContext): AutoCheck {
  const fail = (reason: string): AutoCheck => ({ ok: false, reason });
  if (p.market !== 'VN') return fail('chỉ tự duyệt bài VN');
  if (c.editedByHuman) return fail('đã có người sửa, cần duyệt tay');
  if (p.claims_to_verify.length > 0) return fail('có khẳng định cần kiểm tra');
  if (p.media.engine === 'REMOTION_CARD' && !c.hasImage) return fail('chưa có ảnh thẻ');
  const text = `${p.post.headline}\n${p.post.body}\n${p.post.call_to_action}`;
  if (isIncidentText(text)) return fail('tin sự cố bảo mật: cần người duyệt');
  if (!p.sources.every((s) => campaignSourceAllowed(s.url, c.feedDomains))) return fail('nguồn không nằm trong danh sách RSS đã cấu hình');
  return { ok: true };
}
