import { describe, expect, it } from 'vitest';
import type { ContentPackage } from '../src/domain/package.ts';
import { scoreQuality } from '../src/domain/quality.ts';
import { attentionScore, classifyPillar, riskFlags } from '../src/domain/strategy.ts';
import { pageInfo } from '../src/domain/paging.ts';
import type { ContentRow } from '../src/services/contents.ts';
import { queueView, type RowInfo } from '../src/web/views/queue.ts';

const pkg = (headline: string): ContentPackage => ({
  market: 'VN',
  topic_summary: headline,
  post: { headline, body: 'Nội dung.', call_to_action: 'x?', hashtags: [] },
  sources: [{ title: 's', url: 'https://example.com/a' }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});
const row = (id: number): ContentRow => ({ id, market: 'VN', format: 'TEXT', media_engine: 'NONE', state: 'IN_REVIEW', current_revision: 1, scheduled_at: null, updated_at: new Date().toISOString() }) as unknown as ContentRow;
const infoOf = (p: ContentPackage): RowInfo => {
  const q = scoreQuality(p, 'VN');
  const flags = riskFlags(p);
  return { headline: p.post.headline, claims: 0, sources: 1, editedBy: null, quality: q, bulkOk: false, pillar: classifyPillar(p), flags, attention: attentionScore(flags, q.score) };
};

describe('hàng chờ: chip trụ cột/rủi ro và thứ tự', () => {
  const calm = pkg('Doanh nghiệp bàn lộ trình chuyển đổi số');
  const risky = pkg('Lộ dữ liệu khách hàng tại Công ty ABC');
  const html = queueView({
    ctx: { user: { name: 'Q', email: 'a@x', roles: ['approver_vn'] }, csrf: 't' } as never,
    rows: [row(1), row(2)], // bài sạch đứng trước trong dữ liệu gốc
    info: new Map([['1', infoOf(calm)], ['2', infoOf(risky)]]),
    counts: { IN_REVIEW: 2 }, filter: { state: '', market: '', q: '' }, page: pageInfo(1, 2), markets: ['VN'], now: new Date(),
    canGenerate: false, canPublish: false, genJobs: [], canBulk: true,
  });

  it('hiện trụ cột và chip rủi ro', () => {
    expect(html).toContain('An ninh mạng');
    expect(html).toContain('Tin sự cố');
    expect(html).toContain('risk-high');
  });
  it('bài có cờ cao được xếp trước bài sạch dù đứng sau trong dữ liệu', () => {
    expect(html.indexOf('Lộ dữ liệu khách hàng')).toBeLessThan(html.indexOf('Doanh nghiệp bàn lộ trình'));
  });
});
