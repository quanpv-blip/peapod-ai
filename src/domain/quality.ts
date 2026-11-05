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

const BODY_RANGE: Record<Market, [number, number]> = { VN: [450, 800], JP: [350, 600] };
const HEADLINE_MAX: Record<Market, number> = { VN: 90, JP: 60 };
/** Câu mở đầu (dòng đầu thân bài) tối đa bao nhiêu ký tự thì còn "gọn, có sức hút". */
const HOOK_MAX: Record<Market, number> = { VN: 130, JP: 70 };
const BANNED: Record<Market, string[]> = {
  VN: ['tốt nhất', 'số 1', 'cam kết', 'đảm bảo', 'ngay hôm nay'],
  JP: ['圧倒的', '業界No.1', '絶対', '必ず', 'お問い合わせ', '今すぐ'],
};
// "views" nhận cả nhãn cũ để bài sinh trước khi đổi văn phong không bị chấm sai.
const MARKERS: Record<Market, { key: string; views: string[]; source: string }> = {
  VN: { key: 'Điểm chính', views: ['Góc nhìn của chúng tôi', 'Nhận định của chúng tôi'], source: 'Nguồn:' },
  JP: { key: 'ポイント', views: ['当社の見方'], source: '出典：' },
};
const GENERIC_CTA = ['Theo dõi Fanpage', 'theo dõi Fanpage', 'フォローして', 'お役立てください'];
const BULLET = /^\s*[▸•・\-–]\s*\S/u;
const QUESTION = /[?？]/;

export function scoreQuality(pkg: ContentPackage, market: Market): Quality {
  const issues: QualityIssue[] = [];
  let score = 100;
  const hit = (penalty: number, level: QualityIssue['level'], text: string) => {
    score -= penalty;
    issues.push({ level, text });
  };
  const { headline, body, hashtags, call_to_action: cta } = pkg.post;
  const [min, max] = BODY_RANGE[market];
  const len = [...body].length;

  if (len < min) hit(12, 'warn', `Thân bài hơi ngắn (${len} ký tự, nên từ ${min} đến ${max})`);
  else if (len > max) hit(8, 'warn', `Thân bài hơi dài (${len} ký tự, nên từ ${min} đến ${max})`);
  if ([...headline].length > HEADLINE_MAX[market]) hit(8, 'warn', `Tiêu đề quá ${HEADLINE_MAX[market]} ký tự`);

  const m = MARKERS[market];
  if (!body.includes(m.key)) hit(8, 'warn', `Thiếu mục "${m.key}"`);
  if (!m.views.some((v) => body.includes(v))) hit(8, 'warn', `Thiếu mục "${m.views[0]}"`);
  if (!body.includes(m.source)) hit(8, 'warn', 'Thiếu dòng ghi nguồn ở cuối bài');

  const bullets = body.split('\n').filter((l) => BULLET.test(l)).length;
  if (bullets < 2) hit(8, 'warn', 'Phần "Điểm chính" nên có ít nhất 2 ý, mỗi ý một dòng');

  // Câu mở đầu: dòng đầu tiên của thân bài phải ngắn gọn, không mở bằng "Theo ..." / tên báo.
  const hook = body.split('\n').find((l) => l.trim())?.trim() ?? '';
  if ([...hook].length > HOOK_MAX[market] || /^(Theo |According|によると)/u.test(hook) || /^[📌💡🔗]/u.test(hook)) {
    hit(8, 'warn', 'Chưa có câu mở đầu ngắn, thu hút ở đầu bài');
  }

  if (!cta.trim()) hit(6, 'warn', 'Chưa có lời kêu gọi hành động');
  else if (GENERIC_CTA.some((g) => cta.includes(g))) hit(6, 'warn', 'Lời kêu gọi quá chung chung, nên là câu hỏi thảo luận cụ thể');
  else if (!QUESTION.test(cta)) hit(4, 'warn', 'Lời kêu gọi nên là một câu hỏi để người đọc bình luận');

  if (hashtags.length < 3 || hashtags.length > 5) hit(4, 'warn', `Nên có 3 đến 5 hashtag (hiện ${hashtags.length})`);
  else if (hashtags.some((h) => !h.startsWith('#'))) hit(4, 'warn', 'Hashtag phải bắt đầu bằng #');

  const banned = BANNED[market].filter((w) => body.includes(w) || headline.includes(w));
  if (banned.length) hit(30, 'bad', `Có từ bị cấm: ${banned.join(', ')}`);

  if (pkg.sources.length === 0) hit(30, 'bad', 'Không có nguồn dẫn');
  else if (pkg.sources.length === 1) hit(0, 'warn', 'Chỉ có 1 nguồn dẫn');

  if (pkg.claims_to_verify.length > 0) hit(Math.min(20, 5 * pkg.claims_to_verify.length), 'warn', `${pkg.claims_to_verify.length} khẳng định cần kiểm tra trước khi duyệt`);

  score = Math.max(0, Math.min(100, score));
  const grade: Quality['grade'] = score >= 85 ? 'good' : score >= 60 ? 'ok' : 'low';
  return { score, grade, issues };
}

export const GRADE_TEXT: Record<Quality['grade'], string> = { good: 'Tốt', ok: 'Khá', low: 'Cần xem kỹ' };

/** Bài đủ điều kiện để duyệt hàng loạt: điểm đạt ngưỡng, không lỗi nặng, không có khẳng định cần kiểm. */
export function bulkApprovable(q: Quality, claims: number, minScore = 85): boolean {
  return claims === 0 && q.score >= minScore && !q.issues.some((i) => i.level === 'bad');
}
