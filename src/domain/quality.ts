// Chấm điểm chất lượng bản nháp để người duyệt biết bài nào cần đọc kỹ, bài nào gần như sẵn sàng.
// Đây là kiểm tra thô theo quy tắc biên tập (editorial.ts), không thay thế việc người duyệt đọc.
import type { ContentPackage, Market } from './package.ts';

export interface QualityIssue {
  /** warn: nên xem lại; bad: lỗi rõ ràng, nên sửa trước khi duyệt. */
  level: 'warn' | 'bad';
  text: string;
}

export interface Quality {
  score: number;
  /** good ≥ 85, ok ≥ 60, low còn lại. */
  grade: 'good' | 'ok' | 'low';
  issues: QualityIssue[];
}

const BODY_RANGE: Record<Market, [number, number]> = { VN: [300, 500], JP: [250, 400] };
const HEADLINE_MAX: Record<Market, number> = { VN: 90, JP: 60 };
const BANNED: Record<Market, string[]> = {
  VN: ['tốt nhất', 'số 1', 'cam kết', 'đảm bảo', 'ngay hôm nay'],
  JP: ['圧倒的', '業界No.1', '絶対', '必ず', 'お問い合わせ', '今すぐ'],
};
const MARKERS: Record<Market, { key: string; view: string; source: string }> = {
  VN: { key: 'Điểm chính', view: 'Nhận định của chúng tôi', source: 'Nguồn:' },
  JP: { key: 'ポイント', view: '当社の見方', source: '出典：' },
};

export function scoreQuality(pkg: ContentPackage, market: Market): Quality {
  const issues: QualityIssue[] = [];
  let score = 100;
  const hit = (penalty: number, level: QualityIssue['level'], text: string) => {
    score -= penalty;
    issues.push({ level, text });
  };
  const { headline, body, hashtags } = pkg.post;
  const [min, max] = BODY_RANGE[market];
  const len = [...body].length;

  if (len < min) hit(15, 'warn', `Thân bài hơi ngắn (${len} ký tự, nên từ ${min} đến ${max})`);
  else if (len > max) hit(10, 'warn', `Thân bài hơi dài (${len} ký tự, nên từ ${min} đến ${max})`);
  if ([...headline].length > HEADLINE_MAX[market]) hit(10, 'warn', `Tiêu đề quá ${HEADLINE_MAX[market]} ký tự`);

  const m = MARKERS[market];
  if (!body.includes(m.key)) hit(10, 'warn', `Thiếu mục "${m.key}"`);
  if (!body.includes(m.view)) hit(10, 'warn', `Thiếu mục "${m.view}"`);
  if (!body.includes(m.source)) hit(10, 'warn', 'Thiếu dòng ghi nguồn ở cuối bài');

  const banned = BANNED[market].filter((w) => body.includes(w) || headline.includes(w));
  if (banned.length) hit(30, 'bad', `Có từ bị cấm: ${banned.join(', ')}`);

  if (pkg.sources.length === 0) hit(30, 'bad', 'Không có nguồn dẫn');
  else if (pkg.sources.length === 1) hit(0, 'warn', 'Chỉ có 1 nguồn dẫn');

  if (pkg.claims_to_verify.length > 0) hit(Math.min(20, 5 * pkg.claims_to_verify.length), 'warn', `${pkg.claims_to_verify.length} khẳng định cần kiểm tra trước khi duyệt`);
  if (hashtags.length === 0) hit(5, 'warn', 'Chưa có hashtag');
  if (!pkg.post.call_to_action.trim()) hit(5, 'warn', 'Chưa có lời kêu gọi hành động');

  score = Math.max(0, Math.min(100, score));
  const grade: Quality['grade'] = score >= 85 ? 'good' : score >= 60 ? 'ok' : 'low';
  return { score, grade, issues };
}

export const GRADE_TEXT: Record<Quality['grade'], string> = { good: 'Tốt', ok: 'Khá', low: 'Cần xem kỹ' };

/** Bài đủ điều kiện để duyệt hàng loạt: điểm đạt ngưỡng, không lỗi nặng, không có khẳng định cần kiểm. */
export function bulkApprovable(q: Quality, claims: number, minScore = 85): boolean {
  return claims === 0 && q.score >= minScore && !q.issues.some((i) => i.level === 'bad');
}
