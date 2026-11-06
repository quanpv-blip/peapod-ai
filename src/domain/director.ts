// Đạo diễn AI cho video: từ bài đã duyệt + văn bản nguồn, AI viết KỊCH BẢN PHÂN CẢNH (storyboard) theo lược đồ
// schemas/storyboard.schema.json (sinh từ peapod-video). Engine peapod-video lo bố cục và kiểm tra đầy đủ.
// Phần này thuần (không I/O): soạn prompt, kiểm câu trích có đúng nguyên văn trong nguồn, soạn prompt sửa lỗi.
import type { ContentPackage, Market } from './package.ts';

/** Độ dài lời đọc nhắm tới (ký tự, cả video) để video thật rơi vào 30–60 giây với giọng Gemini. */
export const NARRATION_CHARS: Record<Market, { min: number; max: number }> = { VN: { min: 520, max: 820 }, JP: { min: 190, max: 300 } };

export interface StoryFactLike {
  id: string;
  raw: string;
  quote: string;
}
export interface StoryboardLike {
  facts?: StoryFactLike[];
  scenes: { type: string; say: string[] }[];
}

const RULES: Record<Market, string> = {
  VN: `Bạn là đạo diễn video tin tức B2B dạng dọc 9:16 (Reels), dài 35–55 giây, tiếng Việt.
Nhiệm vụ: viết KỊCH BẢN PHÂN CẢNH dạng JSON đúng lược đồ. Chỉ dùng dữ kiện có trong BÀI ĐÃ DUYỆT và VĂN BẢN NGUỒN. Không bịa, không phóng đại.

Cấu trúc:
- 6 đến 9 cảnh. Cảnh đầu là "hook" (câu mở gợi tò mò, ≤ 60 ký tự, có thể có "sub"). Cảnh cuối là "cta" (một câu hỏi mở cho doanh nghiệp, không "theo dõi Fanpage").
- Ở giữa chọn loại cảnh hợp nội dung. MỖI LOẠI CHỈ DÙNG ĐÚNG CÁC TRƯỜNG SAU (mỗi mục trong "items" là một object):
  • "stat": "factId" + "label" (≤ 40 ký tự), "context" tùy chọn. Không có items.
  • "cards": "items" 2–4 mục, mỗi mục {"factId", "label" ≤ 28 ký tự}.
  • "compare": "title" + "items" 2–4 mục {"factId", "label" ≤ 28 ký tự}, các số cùng đơn vị.
  • "timeline": "items" 2–6 mục {"when" ngắn ≤ 16 ký tự, "text" ≤ 50 ký tự}.
  • "bullets": "title" + "items" 2–5 mục {"text" ≤ 60 ký tự}.
  • "checklist": "items" 3–6 mục {"text" ≤ 36 ký tự}.
  • "process": "title" + "items" 2–5 mục {"text" ≤ 36 ký tự, "detail" tùy chọn}.
  • "alert": "title" + "items" 1–3 mục {"text" ≤ 60 ký tự}. Chỉ dùng cho tin sự cố.
  • "recap": "items" 2–4 mục {"text" ≤ 50 ký tự}.
  Chữ của mục luôn đặt ở "text" (trừ cards/compare dùng "label"). Không để mục rỗng. Mọi "title" ≤ 40 ký tự.
- Mỗi cảnh trừ hook và cta có "chapter": "title" ≤ 16 ký tự, "accent" ≤ 20 ký tự (dòng 2 màu nhấn), "icon" hợp nội dung. Hai cảnh liền nhau cùng chủ đề thì lặp lại đúng chapter.
- "say" là lời đọc, chia đoạn. Cảnh có danh sách: mỗi mục một đoạn theo đúng thứ tự (mục hiện khi đoạn của nó được đọc); được thêm MỘT đoạn dẫn ở đầu. Câu ngắn, văn nói, tự nhiên.
- Tổng lời đọc cả video ${NARRATION_CHARS.VN.min}–${NARRATION_CHARS.VN.max} ký tự. Mỗi cảnh 1–3 câu.

Con số (BẮT BUỘC):
- Mọi con số xuất hiện trong "say", "headline", "sub", "items", "label", "context" phải là một fact trong "facts".
- fact.quote là câu CHÉP NGUYÊN VĂN từ VĂN BẢN NGUỒN hoặc BÀI ĐÃ DUYỆT (không sửa một chữ), chứa đúng chuỗi fact.raw. fact.value là giá trị số quy đổi (15.000 → 15000; 3,5 tỷ → 3500000000).
- Không có câu nào (trong nguồn hoặc bài đã duyệt) chứa số đó thì KHÔNG dùng số đó. Ngày giờ hãy viết bằng chữ ("giữa tháng 10", "rạng sáng") nếu không cần số.
- cards/compare: mỗi mục có "factId" và "label" ≤ 28 ký tự. stat: "factId", "label" ≤ 40 ký tự.

Ai nói (BẮT BUỘC):
- Không gán lời cho người hay tổ chức không có trong nguồn ("chuyên gia cho biết", "theo các nhà nghiên cứu"...).
- Phần "Nhận định của chúng tôi" trong bài là ý kiến của trang: đọc là "theo chúng tôi" hoặc nói thẳng, KHÔNG đổi thành ý chuyên gia.`,
  JP: `あなたはB2Bニュースの縦型動画（9:16、35〜55秒、日本語）のディレクターです。
スキーマどおりの絵コンテJSONを書いてください。承認済み投稿と原文にある事実だけを使い、誇張しないこと。

構成:
- 6〜9シーン。最初は "hook"（30字以内、"sub" 可）、最後は "cta"（企業向けの問いかけ1文）。
- 中間は内容に合う種類。各種類は次のフィールドだけを使う（"items" の各項目はオブジェクト）:
  • "stat": "factId" + "label"（20字以内）。items なし。
  • "cards": "items" 2〜4、各 {"factId", "label" 14字以内}。
  • "compare": "title" + "items" 2〜4 {"factId", "label"}、同じ単位。
  • "timeline": "items" 2〜6 {"when" 8字以内, "text" 25字以内}。
  • "bullets": "title" + "items" 2〜5 {"text" 30字以内}。
  • "checklist": "items" 3〜6 {"text" 18字以内}。
  • "process": "title" + "items" 2〜5 {"text" 18字以内, "detail" 任意}。
  • "alert": "title" + "items" 1〜3 {"text" 30字以内}。事故・障害のニュースのみ。
  • "recap": "items" 2〜4 {"text" 25字以内}。
  項目の文字は "text" に入れる（cards/compare は "label"）。空の項目は作らない。"title" は20字以内。
- hook と cta 以外は "chapter"（"title" 8字以内、"accent" 10字以内、"icon"）。
- "say" はナレーション（段落の配列）。リストのあるシーンは各項目に1段落ずつ順番どおり（先頭に導入1段落を足してよい）。
- 全体のナレーションは ${NARRATION_CHARS.JP.min}〜${NARRATION_CHARS.JP.max} 字。

数字（必須）:
- "say"・"headline"・"items" などに出る数字はすべて "facts" に入れる。
- fact.quote は原文または承認済み投稿から一字一句そのまま写した文で、fact.raw をそのまま含むこと。fact.value は換算値（338万6187 → 3386187）。
- 原文に根拠がない数字は使わない。

発言者（必須）:
- 原文にない人物・組織に発言を帰属させない（「専門家によると」など）。
- 投稿の「当社の見解」は当ページの意見として扱い、専門家の意見に置き換えない。`,
};

/**
 * Ví dụ đầy đủ (chủ đề giả định, số liệu minh họa) để AI thấy đúng hình dạng: mỗi cảnh danh sách có "items" là mảng object,
 * cảnh không có danh sách để "items": []. Chỉ dùng làm khuôn; dữ kiện phải lấy từ bài thật.
 */
const EXAMPLE: Record<Market, object> = {
  VN: {
    facts: [{ id: 'f-shops', label: 'Số cửa hàng bị ảnh hưởng', value: 15, raw: '15', unit: 'cửa hàng', approx: false, quote: '<câu chép nguyên văn chứa 15>' }],
    scenes: [
      { type: 'hook', headline: 'Tủ đông siêu thị bị hack từ xa', sub: 'Một đêm, nhiều nước châu Âu', items: [], say: ['Tin tặc điều khiển tủ đông của hàng loạt siêu thị châu Âu chỉ trong một đêm.'] },
      { type: 'stat', chapter: { title: 'Thiệt hại', accent: 'lan rộng', icon: 'chart' }, factId: 'f-shops', label: 'cửa hàng bị ảnh hưởng', items: [], say: ['Riêng một chuỗi đã có 15 cửa hàng bị ảnh hưởng.'] },
      { type: 'alert', chapter: { title: 'Ai đứng sau?', icon: 'alert' }, title: 'Chưa rõ thủ phạm', items: [{ text: 'Chưa ai nhận trách nhiệm' }, { text: 'Không kèm yêu cầu tiền chuộc' }], say: ['Chưa ai nhận trách nhiệm.', 'Cũng không có yêu cầu tiền chuộc.'] },
      { type: 'checklist', chapter: { title: 'Nên làm', accent: 'ngay', icon: 'shield' }, items: [{ text: 'Tách mạng thiết bị lạnh' }, { text: 'Đổi mật khẩu mặc định' }, { text: 'Bật cảnh báo nhiệt độ' }], say: ['Doanh nghiệp nên làm ba việc:', 'tách mạng thiết bị lạnh,', 'đổi mật khẩu mặc định,', 'và bật cảnh báo nhiệt độ.'] },
      { type: 'recap', chapter: { title: 'Lưu lại', icon: 'document' }, items: [{ text: 'Thiết bị nối mạng là điểm yếu' }, { text: 'Cần giám sát 24/7' }], say: ['Lưu lại:', 'thiết bị nối mạng là điểm yếu,', 'và cần giám sát liên tục.'] },
      { type: 'cta', question: 'Doanh nghiệp bạn có thiết bị nào điều khiển qua Internet?', items: [], say: ['Doanh nghiệp bạn có thiết bị nào điều khiển qua Internet?'] },
    ],
  },
  JP: {
    facts: [{ id: 'f-cnt', label: '流出件数', value: 3386187, raw: '338万6187', unit: '件', approx: false, quote: '<338万6187を含む原文そのままの文>' }],
    scenes: [
      { type: 'hook', headline: '会員情報338万件が流出', items: [], say: ['大手サービスで会員情報が大量に流出しました。'] },
      { type: 'stat', chapter: { title: '被害', accent: '過去最大', icon: 'chart' }, factId: 'f-cnt', label: '流出した件数', items: [], say: ['その数、338万6187件です。'] },
      { type: 'checklist', chapter: { title: '対策', icon: 'shield' }, items: [{ text: 'パスワード変更' }, { text: '二段階認証' }, { text: '不審メール注意' }], say: ['今すぐできる対策は三つ。', 'パスワード変更、', '二段階認証、', '不審なメールへの注意です。'] },
      { type: 'cta', question: '御社の対策は十分ですか？', items: [], say: ['御社の対策は十分ですか？'] },
    ],
  },
};

/** 空白・改行の違いを無視して比較するための正規化。 */
const norm = (s: string) => s.normalize('NFC').replace(/[\s ]+/g, ' ').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();

export function directorSystem(market: Market): string {
  const head = market === 'JP' ? '出力の形の例（内容は例。事実は必ず本物の記事から）:' : 'Ví dụ HÌNH DẠNG đầu ra (nội dung chỉ minh họa; dữ kiện phải lấy từ bài thật):';
  return `${RULES[market]}\n\n${head}\n${JSON.stringify(EXAMPLE[market])}`;
}

export function directorUser(pkg: ContentPackage, sourceText: string): string {
  return [
    `BÀI ĐÃ DUYỆT / 承認済み投稿:`,
    `Tiêu đề: ${pkg.post.headline}`,
    pkg.post.body,
    ``,
    `VĂN BẢN NGUỒN / 原文 (${pkg.sources[0]?.title ?? ''}):`,
    sourceText.trim() || '(không có — chỉ dùng số có trong bài đã duyệt, chép câu từ bài đã duyệt)',
  ].join('\n');
}

/** Kiểm câu trích: phải nằm nguyên văn trong văn bản cho phép, và phải chứa fact.raw. Trả danh sách lỗi (rỗng là đạt). */
export function quoteIssues(sb: StoryboardLike, allowedText: string): string[] {
  const hay = norm(allowedText);
  const out: string[] = [];
  for (const f of sb.facts ?? []) {
    const q = norm(f.quote);
    if (!hay.includes(q)) out.push(`facts[${f.id}].quote không phải câu chép nguyên văn từ văn bản nguồn: "${f.quote.slice(0, 80)}"`);
    else if (!q.includes(norm(f.raw))) out.push(`facts[${f.id}].raw "${f.raw}" không có trong quote của chính nó`);
  }
  return out;
}

/** Tổng số ký tự lời đọc (để báo khi lệch xa khoảng nhắm tới). */
export function narrationChars(sb: StoryboardLike): number {
  return sb.scenes.reduce((a, s) => a + s.say.join(' ').length, 0);
}

/** Prompt sửa: kịch bản cũ + danh sách lỗi cụ thể. AI phải trả lại TOÀN BỘ kịch bản đã sửa. */
export function directorFix(previous: unknown, problems: string[], market: Market): string {
  const head = market === 'JP' ? '前回の絵コンテに次の問題があります。すべて直して、絵コンテ全体をJSONで返してください。' : 'Kịch bản trước có các lỗi sau. Sửa hết và trả lại TOÀN BỘ kịch bản dạng JSON.';
  return `${head}\n\n${problems.slice(0, 25).map((p, i) => `${i + 1}. ${p}`).join('\n')}\n\n${JSON.stringify(previous)}`;
}
