import { describe, expect, it, vi } from 'vitest';
import { cardInputFrom, extractTakeaway, type CardInput } from '../src/media/card.ts';
import { remoteCardConfigFromEnv, renderCardRemote } from '../src/media/remote-card.ts';
import type { ContentPackage } from '../src/domain/package.ts';

const card: CardInput = {
  market: 'VN',
  title: 'Tiêu đề thử',
  bullets: ['Ý một', 'Ý hai'],
  takeaway: 'Nhận định thử.',
  source: 'VnExpress',
  date: '05/11/2026',
};

const pkg = (over: Partial<ContentPackage> = {}): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline: 'Tiêu đề', body: 'Đoạn mở đầu.\n\nNhận định của chúng tôi: Chuỗi giá trị đang mở rộng.\n\n#chip #AI', call_to_action: 'x', hashtags: [] },
  sources: [{ title: 'VnExpress', url: 'https://vnexpress.net/a' }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
  ...over,
});

describe('nhận định trên thẻ', () => {
  it('VN: lấy đoạn cùng dòng với nhãn', () => {
    expect(extractTakeaway(pkg().post.body, 'VN')).toBe('Chuỗi giá trị đang mở rộng.');
  });
  it('JP: lấy đoạn dưới nhãn 当社の見方, dừng ở dòng 出典', () => {
    const body = '本文。\n\n当社の見方\nセキュリティ基盤の信頼性を維持するため、定期的な確認が重要です。\n\n出典：Nikkei XTECH';
    expect(extractTakeaway(body, 'JP')).toBe('セキュリティ基盤の信頼性を維持するため、定期的な確認が重要です。');
  });
  it('không có nhãn thì null', () => {
    expect(extractTakeaway('Không có nhận định ở đây.', 'VN')).toBeNull();
  });
  it('cắt tối đa 160 ký tự', () => {
    const long = `Nhận định của chúng tôi: ${'a'.repeat(300)}`;
    expect(extractTakeaway(long, 'VN')!.length).toBeLessThanOrEqual(160);
  });
});

describe('dữ liệu thẻ từ gói bài', () => {
  it('cắt tiêu đề, ý và nguồn theo đúng giới hạn của dịch vụ Remotion', () => {
    const input = cardInputFrom(
      pkg({
        post: { headline: 'x'.repeat(200), body: '', call_to_action: 'x', hashtags: [] },
        sources: [{ title: 'y'.repeat(200), url: 'https://a.test' }],
        media: { engine: 'NONE', card: { bullets: ['1', '2', '3', '4', 'z'.repeat(200)] } } as unknown as ContentPackage['media'],
      }),
      '05/11/2026',
    );
    expect(input.title.length).toBeLessThanOrEqual(90);
    expect(input.bullets).toHaveLength(3);
    expect(input.bullets.every((b) => b.length <= 80)).toBe(true);
    expect(input.source.length).toBeLessThanOrEqual(80);
    expect(input.takeaway).toBeNull();
  });
});

describe('client dịch vụ Remotion', () => {
  const cfg = { url: 'http://render.test', token: 't'.repeat(64) };
  const png = Buffer.alloc(2000, 1);

  it('gửi đúng các trường thẻ kèm token, trả về PNG', async () => {
    const f = vi.fn(async () => new Response(png, { status: 200 }));
    const out = await renderCardRemote(card, cfg, f as unknown as typeof fetch);
    expect(out).toEqual(png);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://render.test/render/card');
    expect((init.headers as Record<string, string>)['X-Render-Token']).toBe(cfg.token);
    expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual(['bullets', 'date', 'market', 'source', 'takeaway', 'title']);
  });

  it('lỗi HTTP, mạng đứt hoặc phản hồi quá nhỏ đều trả về null (để dùng Satori)', async () => {
    expect(await renderCardRemote(card, cfg, (async () => new Response('x', { status: 500 })) as unknown as typeof fetch)).toBeNull();
    expect(await renderCardRemote(card, cfg, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch)).toBeNull();
    expect(await renderCardRemote(card, cfg, (async () => new Response(Buffer.alloc(10), { status: 200 })) as unknown as typeof fetch)).toBeNull();
  });

  it('cấu hình thiếu thì tắt; URL thừa dấu / cuối được bỏ', () => {
    expect(remoteCardConfigFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
    expect(remoteCardConfigFromEnv({ REMOTION_RENDER_URL: 'http://h:4100/', REMOTION_RENDER_TOKEN: 'abc' } as NodeJS.ProcessEnv)).toEqual({ url: 'http://h:4100', token: 'abc' });
  });
});
