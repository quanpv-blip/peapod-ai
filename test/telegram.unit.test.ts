import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyTelegram, telegramFromEnv } from '../src/providers/telegram.ts';

const okFetch = (status = 200) => vi.fn(async () => new Response('{}', { status }));

describe('kênh Telegram', () => {
  afterEach(() => vi.restoreAllMocks());

  it('thiếu token hoặc chat id thì bỏ qua, không gọi mạng', async () => {
    const f = okFetch();
    expect(await notifyTelegram('x', { token: undefined, chatId: '-1' }, f)).toBe(false);
    expect(await notifyTelegram('x', { token: 'a:b', chatId: undefined }, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it('gửi sendMessage đúng địa chỉ, chat_id và nội dung', async () => {
    const f = okFetch();
    const ok = await notifyTelegram('Bài #5 lỗi', { token: '123:abc', chatId: '-5412326789' }, f);
    expect(ok).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
    expect(JSON.parse(init.body as string)).toMatchObject({ chat_id: '-5412326789', text: 'Bài #5 lỗi', disable_web_page_preview: true });
  });

  it('cắt tin quá 4096 ký tự', async () => {
    const f = okFetch();
    await notifyTelegram('a'.repeat(5000), { token: '1:x', chatId: '-1' }, f);
    const body = JSON.parse((f.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.text).toHaveLength(4096);
  });

  it('HTTP lỗi hoặc mạng đứt thì trả về false, không ném lỗi', async () => {
    expect(await notifyTelegram('x', { token: '1:x', chatId: '-1' }, okFetch(429))).toBe(false);
    const broken = vi.fn(async () => { throw new Error('ECONNRESET'); });
    expect(await notifyTelegram('x', { token: '1:x', chatId: '-1' }, broken as unknown as typeof fetch)).toBe(false);
  });

  it('đọc cấu hình từ biến môi trường, bỏ khoảng trắng', () => {
    expect(telegramFromEnv({ TELEGRAM_BOT_TOKEN: ' 1:x ', TELEGRAM_CHAT_ID: ' -9 ' } as NodeJS.ProcessEnv)).toEqual({ token: '1:x', chatId: '-9' });
    expect(telegramFromEnv({ TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '' } as NodeJS.ProcessEnv)).toEqual({ token: undefined, chatId: undefined });
  });
});
