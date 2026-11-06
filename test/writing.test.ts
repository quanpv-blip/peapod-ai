import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { readFileSync } from 'node:fs';
import { NEWS_EXAMPLE, NEWS_VOICE, REWRITE_STYLES, isRewriteStyle, rewriteUserPrompt, newsUserPrompt } from '../src/domain/editorial.ts';
import { normalizeHashtags, polishPackage, tidyBody } from '../src/domain/polish.ts';
import { scoreQuality } from '../src/domain/quality.ts';
import { validatePackage, type ContentPackage } from '../src/domain/package.ts';
import type { GeminiClient } from '../src/providers/gemini.ts';
import type { Actor } from '../src/auth.ts';
import { createGenerated, getContent } from '../src/services/contents.ts';
import { rewritePost } from '../src/services/rewrite.ts';
import { freshDb } from './helpers/freshDb.ts';
import { GOOD_BODY } from './bigupdate.unit.test.ts';

const base = (over: Partial<ContentPackage['post']> = {}): ContentPackage => ({
  market: 'VN', topic_summary: 't',
  post: { headline: 'Công ty A ra mắt nền tảng dữ liệu mới', body: GOOD_BODY, call_to_action: 'Báo cáo của bạn mất bao lâu mỗi tuần?', hashtags: ['#DuLieu', '#ChuyenDoiSo', '#SME'], ...over },
  sources: [{ title: 'VnExpress', url: 'https://vnexpress.net/a' }], claims_to_verify: [], media: { engine: 'NONE' },
});

describe('văn phong biên tập v2', () => {
  it('prompt đòi hỏi câu mở đầu, điểm chính cụ thể, góc nhìn có đối tượng, câu hỏi thảo luận và hashtag', () => {
    for (const m of ['VN', 'JP'] as const) {
      const v = NEWS_VOICE[m];
      expect(v).toContain('▸');
      expect(v).toContain('📌');
      expect(v).toContain('💡');
      expect(v).toContain('hashtags');
      expect(v).toMatch(/câu hỏi thảo luận/);
    }
    expect(NEWS_VOICE.VN).toContain('Góc nhìn của chúng tôi');
    expect(NEWS_VOICE.JP).toContain('当社の見方');
  });

  it('ví dụ văn phong đủ cấu trúc và đạt điểm tốt khi đưa qua bộ chấm', () => {
    const body = /body:\n([\s\S]*?)\ncall_to_action:/.exec(NEWS_EXAMPLE.VN)![1]!;
    const cta = /call_to_action: (.*)/.exec(NEWS_EXAMPLE.VN)![1]!;
    const tags = /hashtags: (.*)/.exec(NEWS_EXAMPLE.VN)![1]!.split(' ');
    const q = scoreQuality(base({ body, call_to_action: cta, hashtags: tags }), 'VN');
    expect(q.issues.filter((i) => i.level === 'bad')).toEqual([]);
    expect(q.score).toBeGreaterThanOrEqual(85);
  });

  it('ví dụ nói rõ là hư cấu và cấm dùng lại số liệu', () => {
    expect(NEWS_EXAMPLE.VN).toContain('hư cấu');
    expect(NEWS_EXAMPLE.JP).toContain('架空');
  });

  it('prompt thẻ ảnh yêu cầu tiêu đề có điểm nhấn và đúng 3 ý ngắn', () => {
    const p = newsUserPrompt('VN', '1. Tin\n   URL: https://x.test/a');
    expect(p).toContain('đúng 3 mục');
  });
});

describe('chuẩn hóa bài trước khi vào hàng chờ', () => {
  it('hashtag: thêm #, bỏ khoảng trắng và trùng, tối đa 5', () => {
    expect(normalizeHashtags(['AI', '# Chuyển Đổi Số', '#ai', 'DX,', '', '#a', '#b', '#c', '#d'])).toEqual(['#AI', '#ChuyểnĐổiSố', '#DX', '#a', '#b']);
  });

  it('thân bài: gộp dòng trống thừa, bỏ khoảng trắng cuối dòng', () => {
    expect(tidyBody('A  \n\n\n\nB\r\n')).toBe('A\n\nB');
  });

  it('polishPackage không đổi nguồn, claims hay media', () => {
    const p = base({ hashtags: ['x', 'y'] });
    const out = polishPackage(p);
    expect(out.sources).toEqual(p.sources);
    expect(out.post.hashtags).toEqual(['#x', '#y']);
  });
});

describe('bộ chấm chất lượng theo chuẩn mới', () => {
  it('bài đúng chuẩn mới: điểm tốt', () => {
    const q = scoreQuality(base(), 'VN');
    expect(q.score).toBeGreaterThanOrEqual(85);
    expect(q.issues.filter((i) => i.level === 'bad')).toEqual([]);
  });

  it('lời kêu gọi chung chung hoặc không phải câu hỏi bị trừ điểm', () => {
    expect(scoreQuality(base({ call_to_action: 'Theo dõi Fanpage để cập nhật tin mới nhất.' }), 'VN').issues.map((i) => i.text).join('|')).toContain('chung chung');
    expect(scoreQuality(base({ call_to_action: 'Hãy chia sẻ ý kiến của bạn.' }), 'VN').issues.map((i) => i.text).join('|')).toContain('câu hỏi');
  });

  it('mở đầu bằng "Theo ..." hoặc thiếu hashtag bị nhắc', () => {
    const q = scoreQuality(base({ body: `Theo VnExpress, có tin mới.\n\n${GOOD_BODY}`, hashtags: ['#A'] }), 'VN');
    const t = q.issues.map((i) => i.text).join('|');
    expect(t).toContain('câu mở đầu');
    expect(t).toContain('hashtag');
  });

  it('nhãn cũ "Nhận định của chúng tôi" vẫn được chấp nhận (bài sinh trước đây không bị chấm sai)', () => {
    const q = scoreQuality(base({ body: GOOD_BODY.replace('Góc nhìn của chúng tôi', 'Nhận định của chúng tôi') }), 'VN');
    expect(q.issues.map((i) => i.text).join('|')).not.toContain('Thiếu mục "Góc nhìn');
  });

  it('bài kiểu cũ (ngắn, không câu mở đầu, CTA chung chung) điểm thấp hơn rõ rệt', () => {
    const old = base({
      body: 'Sự kiện chính thức khởi động vào 14h ngày 5/11.\n\nĐiểm chính:\n• Quy tụ chuyên gia.\n• Vinh danh giải pháp.\n\nNhận định của chúng tôi: Đây là cơ hội kết nối thiết thực.\n\nNguồn: VnExpress',
      call_to_action: 'Theo dõi Fanpage để cập nhật thông tin công nghệ mới nhất.',
      hashtags: ['AI4VN', 'TriTueNhanTao', 'CongNghe', 'AI2026', 'TinTucIT'],
    });
    expect(scoreQuality(old, 'VN').score).toBeLessThan(scoreQuality(base(), 'VN').score - 20);
  });
});

describe('viết lại bằng AI: prompt', () => {
  it('có bài gốc, nguồn nguyên văn và hướng chỉnh; các hướng đều hợp lệ', () => {
    const p = rewriteUserPrompt('VN', 'catchy', base().post, base().sources);
    expect(p).toContain('Hấp dẫn hơn');
    expect(p).toContain('https://vnexpress.net/a');
    expect(p).toContain(GOOD_BODY.slice(0, 30));
    expect(Object.keys(REWRITE_STYLES).every(isRewriteStyle)).toBe(true);
    expect(isRewriteStyle('hack')).toBe(false);
  });
});

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql'];
const schema = JSON.parse(readFileSync(new URL('../schemas/content_package.schema.json', import.meta.url), 'utf8')).schema as object;
const vn: Actor = { email: 'vn@t', name: 'VN', roles: ['approver_vn'] };
const jp: Actor = { email: 'jp@t', name: 'JP', roles: ['approver_jp'] };

d('viết lại bằng AI (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
  beforeAll(async () => { const f = await freshDb(URL_!, MIGRATIONS); db = f.db; drop = f.drop; });
  afterAll(async () => { await drop?.(); });

  const gem = (post: Partial<ContentPackage['post']>, extra: Partial<ContentPackage> = {}) => ({
    generateJson: vi.fn(async () => ({ json: { ...base(), post: { ...base().post, ...post }, ...extra }, usage: { inputTokens: 10, outputTokens: 10, thoughtTokens: 0 } })),
  }) as unknown as GeminiClient & { generateJson: ReturnType<typeof vi.fn> };

  it('tạo revision mới do người bấm lưu, giữ nguyên nguồn dù AI trả nguồn khác, ghi chi phí', async () => {
    const id = await createGenerated(db, base({ headline: 'Tiêu đề cũ' }), 't');
    const g = gem({ headline: 'Tiêu đề mới sắc hơn nhiều', hashtags: ['x', 'y', 'z'] }, { sources: [{ title: 'Giả', url: 'https://evil.test/x' }] });
    const rev = await rewritePost({ db, gemini: g, schema, model: 'm' }, vn, id, 'catchy');
    expect(rev).toBe(2);
    const after = await getContent(db, vn, id);
    expect(after.package.post.headline).toBe('Tiêu đề mới sắc hơn nhiều');
    expect(after.package.post.hashtags).toEqual(['#x', '#y', '#z']);
    expect(after.package.sources[0]!.url).toBe('https://vnexpress.net/a');
    expect(after.editedBy).toBe('vn@t');
    expect((await db.query('SELECT count(*)::int AS n FROM ai_usage')).rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('sửa theo góp ý: góp ý nằm trong prompt, nguồn vẫn giữ nguyên, góp ý quá ngắn bị từ chối', async () => {
    const id = await createGenerated(db, base({ headline: 'Tiêu đề trước góp ý' }), 't');
    const g = gem({ headline: 'Tiêu đề sau góp ý, nêu rõ ai bị ảnh hưởng' }, { sources: [{ title: 'Giả', url: 'https://evil.test/y' }] });
    const rev = await rewritePost({ db, gemini: g, schema, model: 'm' }, vn, id, { feedback: 'Rút gọn phần mở đầu và nêu rõ ai bị ảnh hưởng' });
    expect(rev).toBe(2);
    const sent = (g.generateJson.mock.calls[0]![0] as { user: string }).user;
    expect(sent).toContain('GÓP Ý: Rút gọn phần mở đầu và nêu rõ ai bị ảnh hưởng');
    expect(sent).toContain('KHÔNG thêm');
    expect((await getContent(db, vn, id)).package.sources[0]!.url).toBe('https://vnexpress.net/a');

    const id2 = await createGenerated(db, base({ headline: 'Bài khác' }), 't');
    const g2 = gem({ headline: 'x' });
    await expect(rewritePost({ db, gemini: g2, schema, model: 'm' }, vn, id2, { feedback: 'ok' })).rejects.toThrow('Góp ý cần từ');
    expect(g2.generateJson).not.toHaveBeenCalled();
  });

  it('AI viết sai ngôn ngữ hoặc không đổi gì thì từ chối và không tạo revision', async () => {
    const id = await createGenerated(db, base(), 't');
    await expect(rewritePost({ db, gemini: gem({ body: 'This is an English body that is entirely in English words.' }), schema, model: 'm' }, vn, id, 'concise')).rejects.toThrow('ngôn ngữ');
    await expect(rewritePost({ db, gemini: gem({}), schema, model: 'm' }, vn, id, 'concise')).rejects.toThrow('không thay đổi');
    expect((await getContent(db, vn, id)).item.current_revision).toBe(1);
  });

  it('người không có quyền thị trường không viết lại được; lỗi AI báo bằng tiếng Việt', async () => {
    const id = await createGenerated(db, base(), 't');
    await expect(rewritePost({ db, gemini: gem({ headline: 'Khác' }), schema, model: 'm' }, jp, id, 'catchy')).rejects.toThrow('Không tìm thấy');
    const bad = { generateJson: vi.fn(async () => { throw new Error('quota'); }) } as unknown as GeminiClient;
    await expect(rewritePost({ db, gemini: bad, schema, model: 'm' }, vn, id, 'catchy')).rejects.toThrow('Không gọi được AI');
  });

  it('gói AI trả sai schema bị từ chối', async () => {
    const id = await createGenerated(db, base(), 't');
    const bad = { generateJson: vi.fn(async () => ({ json: { nope: 1 }, usage: { inputTokens: 1, outputTokens: 1, thoughtTokens: 0 } })) } as unknown as GeminiClient;
    await expect(rewritePost({ db, gemini: bad, schema, model: 'm' }, vn, id, 'catchy')).rejects.toThrow('không hợp lệ');
    expect(validatePackage({ nope: 1 }).ok).toBe(false);
  });
});
