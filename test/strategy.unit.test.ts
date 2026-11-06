import { describe, expect, it } from 'vitest';
import { attentionScore, classifyPillar, findDuplicate, jaccard, keyTokens, pillarBalance, riskFlags } from '../src/domain/strategy.ts';
import type { ContentPackage, Market } from '../src/domain/package.ts';

const pkg = (headline: string, over: { body?: string; summary?: string; market?: Market; claims?: string[] } = {}): ContentPackage => ({
  market: over.market ?? 'VN',
  topic_summary: over.summary ?? headline,
  post: { headline, body: over.body ?? 'Nội dung bình thường.', call_to_action: 'x?', hashtags: [] },
  sources: [{ title: 's', url: 'https://example.com/a' }],
  claims_to_verify: over.claims ?? [],
  media: { engine: 'NONE' },
});

describe('trụ cột', () => {
  it('phân loại theo từ khóa tiêu đề', () => {
    expect(classifyPillar(pkg('Lộ dữ liệu khách hàng tại ngân hàng X'))).toBe('security');
    expect(classifyPillar(pkg('FPT mở nhà máy kiểm thử chip bán dẫn'))).toBe('semiconductor');
    expect(classifyPillar(pkg('Doanh nghiệp đưa chatbot AI vào chăm sóc khách hàng'))).toBe('ai');
    expect(classifyPillar(pkg('Mở rộng trung tâm dữ liệu tại Hà Nội'))).toBe('cloud');
    expect(classifyPillar(pkg('Thiếu hụt nhân lực công nghệ cao'))).toBe('workforce');
    expect(classifyPillar(pkg('Một tin không rõ chủ đề'))).toBe('other');
  });
  it('tiếng Nhật', () => {
    expect(classifyPillar(pkg('半導体工場の新設', { market: 'JP' }))).toBe('semiconductor');
    expect(classifyPillar(pkg('不正アクセスによる情報漏洩', { market: 'JP' }))).toBe('security');
  });
  it('tiêu đề thắng thân bài; thân bài dùng khi tiêu đề không rõ', () => {
    expect(classifyPillar(pkg('Tin mới hôm nay', { body: 'Đợt tấn công mạng nhắm vào nhiều tổ chức.' }))).toBe('security');
  });
  it('cân bằng trụ cột cộng đúng và tỷ lệ', () => {
    const b = pillarBalance([pkg('Chip bán dẫn A'), pkg('Chip bán dẫn B'), pkg('Tin chung'), pkg('Bảo mật dữ liệu')]);
    expect(b.find((x) => x.pillar === 'semiconductor')).toMatchObject({ n: 2, pct: 50 });
    expect(b.reduce((s, x) => s + x.n, 0)).toBe(4);
  });
});

describe('cờ rủi ro', () => {
  it('tin sự cố là mức cao', () => {
    const f = riskFlags(pkg('Tấn công mạng vào Công ty ABC', { body: 'Công ty ABC báo bị mã độc mã hóa dữ liệu.' }));
    expect(f.some((x) => x.code === 'incident' && x.level === 'high')).toBe(true);
    expect(f.some((x) => x.code === 'named_company')).toBe(true);
  });
  it('số liệu và khẳng định cần kiểm là mức trung bình', () => {
    const f = riskFlags(pkg('Thị trường tăng 25%', { claims: ['25% là số của quý nào?'] }));
    expect(f.map((x) => x.code).sort()).toEqual(['figures', 'unverified']);
    expect(f.every((x) => x.level === 'medium')).toBe(true);
  });
  it('bài thường không có cờ', () => {
    expect(riskFlags(pkg('Doanh nghiệp bàn về lộ trình số'))).toEqual([]);
  });
  it('mức chú ý: bài có cờ cao đứng trước bài sạch dù điểm chất lượng cao hơn', () => {
    const risky = attentionScore(riskFlags(pkg('Lộ dữ liệu tại Công ty ABC')), 95);
    const clean = attentionScore([], 70);
    expect(risky).toBeGreaterThan(clean);
  });
});

describe('chống trùng ý', () => {
  const recent = [
    { id: 1, headline: 'FPT vận hành nhà máy kiểm thử chip tại Bắc Ninh', summary: 'FPT khai trương nhà máy kiểm thử chip bán dẫn ở Bắc Ninh' },
    { id: 2, headline: 'Ngân hàng X nâng cấp hệ thống lõi', summary: 'Ngân hàng X chuyển hệ thống lõi lên đám mây' },
  ];
  it('bắt bài viết lại cùng một câu chuyện', () => {
    const d = findDuplicate(pkg('Nhà máy kiểm thử chip của FPT tại Bắc Ninh đi vào vận hành', { summary: 'FPT vận hành nhà máy kiểm thử chip bán dẫn tại Bắc Ninh' }), recent);
    expect(d?.id).toBe(1);
  });
  it('không chặn nhầm tin khác cùng ngành', () => {
    expect(findDuplicate(pkg('TSMC mở rộng sản xuất chip tại Nhật Bản', { summary: 'TSMC xây thêm nhà máy ở Kumamoto' }), recent)).toBeNull();
  });
  it('tiếng Nhật dùng bigram', () => {
    const a = pkg('半導体工場の新設を発表', { market: 'JP', summary: '大手メーカーが半導体工場を新設' });
    const r = [{ id: 9, headline: '大手メーカーが半導体工場の新設を発表', summary: '半導体工場を新設すると発表した' }];
    expect(findDuplicate(a, r)?.id).toBe(9);
    expect(findDuplicate(pkg('クラウド障害の影響', { market: 'JP', summary: 'クラウドサービスで障害' }), r)).toBeNull();
  });
  it('jaccard rỗng = 0', () => {
    expect(jaccard(new Set(), keyTokens('abc def', 'VN'))).toBe(0);
  });
});
