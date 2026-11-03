import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { ContentPackage } from '../src/domain/package.ts';
import type { TgUpdate } from '../src/providers/telegram.ts';
import { createGenerated } from '../src/services/contents.ts';
import { handleUpdate, parseAllowlist, parseCommand, type BotDeps } from '../src/services/telegramBot.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql'];
const TOKEN = '111:test-token';
const ALLOWED = 42;
const STRANGER = 999;

const pkg = (headline: string, n: number): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline, body: 'Nội dung tiếng Việt trung lập về sự kiện công nghệ hôm nay.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#CN'] },
  sources: [{ title: 'VnExpress', url: `https://vnexpress.net/b${n}` }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});

// Ghi lại mọi lời gọi Bot API thay vì gửi thật.
function captureTelegram() {
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const method = String(url).split('/').pop()!;
    calls.push({ method, body: JSON.parse(String(init.body)) });
    return new Response('{"ok":true,"result":{}}', { status: 200 });
  }));
  return calls;
}

const msg = (from: number, text: string, chat = from): TgUpdate => ({
  update_id: 1,
  message: { message_id: 1, chat: { id: chat, type: chat < 0 ? 'group' : 'private' }, from: { id: from }, text },
});

describe('phân tích lệnh và danh sách quyền (thuần)', () => {
  it('tách lệnh, bỏ @tên bot, giữ tham số', () => {
    expect(parseCommand('/start')).toEqual({ cmd: 'start', args: '' });
    expect(parseCommand('/tao@peapod2k3_bot VN Chip AI')).toEqual({ cmd: 'tao', args: 'VN Chip AI' });
    expect(parseCommand('xin chào')).toBeNull();
  });
  it('danh sách quyền bỏ giá trị lạ và khoảng trắng', () => {
    expect([...parseAllowlist(' 42, abc, -1, 7 ,')].sort((a, b) => a - b)).toEqual([7, 42]);
    expect(parseAllowlist(undefined).size).toBe(0);
  });
});

d('bot Telegram: lệnh và quyền truy cập (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;
  let calls: { method: string; body: Record<string, unknown> }[];
  let ids: number[];

  const deps = (over: Partial<BotDeps> = {}): BotDeps => ({
    db,
    token: TOKEN,
    allowed: new Set([ALLOWED]),
    appUrl: 'http://localhost:3000',
    createTopic: null,
    ...over,
  });

  beforeAll(async () => {
    const f = await freshDb(URL_!, MIGRATIONS);
    db = f.db;
    drop = f.drop;
    ids = [];
    ids.push(await createGenerated(db, pkg('Chip AI mới ra mắt tại Việt Nam', 1), 'test'));
    ids.push(await createGenerated(db, pkg('Doanh nghiệp mở nhà máy bán dẫn', 2), 'test'));
    // Một bài đã duyệt, đặt giờ đăng để kiểm tra mục "Sắp đăng".
    await db.query("UPDATE content_item SET state = 'APPROVED', scheduled_at = now() + interval '2 hours' WHERE id = $1", [ids[1]]);
  });
  afterAll(async () => {
    await drop?.();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('người chưa được cấp quyền chỉ nhận hướng dẫn kèm ID, không thấy danh sách', async () => {
    calls = captureTelegram();
    await handleUpdate(deps(), msg(STRANGER, '/start'));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.body.text)).toContain(`ID của bạn: ${STRANGER}`);
    expect(calls[0]!.body.reply_markup).toBeUndefined();
  });

  it('người chưa được cấp quyền gửi lệnh khác thì bị bỏ qua hoàn toàn', async () => {
    calls = captureTelegram();
    await handleUpdate(deps(), msg(STRANGER, '/pending'));
    expect(calls).toHaveLength(0);
  });

  it('/start cho người được cấp quyền: hiện menu nút bấm và liên kết web', async () => {
    calls = captureTelegram();
    await handleUpdate(deps(), msg(ALLOWED, '/start'));
    const keyboard = JSON.stringify(calls[0]!.body.reply_markup);
    expect(keyboard).toContain('"callback_data":"pending"');
    expect(keyboard).toContain('"callback_data":"upcoming"');
    // Liên kết https mới được gắn; địa chỉ http cục bộ không gắn vì Telegram từ chối.
    expect(keyboard).not.toContain('"url"');
  });

  it('/pending liệt kê bài chờ duyệt kèm liên kết', async () => {
    calls = captureTelegram();
    await handleUpdate(deps(), msg(ALLOWED, '/pending'));
    const text = String(calls[0]!.body.text);
    expect(text).toContain('Chờ duyệt: 1 bài');
    expect(text).toContain(`#${ids[0]} [VN] Chip AI mới ra mắt tại Việt Nam`);
    expect(text).toContain(`http://localhost:3000/contents/${ids[0]}`);
    expect(text).not.toContain(`#${ids[1]}`);
  });

  it('/upcoming liệt kê bài đã duyệt hoặc đã hẹn giờ', async () => {
    calls = captureTelegram();
    await handleUpdate(deps(), msg(ALLOWED, '/upcoming'));
    const text = String(calls[0]!.body.text);
    expect(text).toContain(`#${ids[1]} [VN]`);
    expect(text).toContain('đã duyệt');
    expect(text).toContain('ICT');
  });

  it('nút bấm: trả lời callback để hết xoay vòng, rồi gửi danh sách', async () => {
    calls = captureTelegram();
    await handleUpdate(deps(), { update_id: 2, callback_query: { id: 'cb1', from: { id: ALLOWED }, data: 'pending', message: { chat: { id: ALLOWED, type: 'private' } } } });
    expect(calls.map((c) => c.method)).toEqual(['answerCallbackQuery', 'sendMessage']);
    expect(calls[0]!.body.callback_query_id).toBe('cb1');
    expect(String(calls[1]!.body.text)).toContain('Chờ duyệt');
  });

  it('/tao không kèm chủ đề: hướng dẫn cách dùng, không tạo gì', async () => {
    calls = captureTelegram();
    const create = vi.fn(async () => 'ok');
    await handleUpdate(deps({ createTopic: create }), msg(ALLOWED, '/tao'));
    expect(String(calls[0]!.body.text)).toContain('/tao');
    expect(create).not.toHaveBeenCalled();
  });

  it('/tao VN chủ đề: báo đang tạo rồi gửi kết quả; thị trường đọc đúng', async () => {
    calls = captureTelegram();
    const create = vi.fn(async (market: string, topic: string) => `✅ Đã tạo bài (${market}): ${topic}`);
    await handleUpdate(deps({ createTopic: create }), msg(ALLOWED, '/tao VN Chip AI bán dẫn'));
    expect(create).toHaveBeenCalledWith('VN', 'Chip AI bán dẫn');
    expect(String(calls[0]!.body.text)).toContain('Đang tạo bài VN');
    await new Promise((r) => setTimeout(r, 10));
    expect(String(calls.at(-1)!.body.text)).toContain('Đã tạo bài (VN)');
  });

  it('chưa có khóa AI: báo rõ, không gọi tạo bài', async () => {
    calls = captureTelegram();
    await handleUpdate(deps({ createTopic: null }), msg(ALLOWED, '/tao Chip AI Việt Nam'));
    expect(String(calls[0]!.body.text)).toContain('Chưa cấu hình khóa Gemini');
  });

  it('lệnh không quen trong nhóm bị bỏ qua, không trả lời lạc', async () => {
    calls = captureTelegram();
    await handleUpdate(deps(), msg(ALLOWED, '/abcxyz', -1001));
    expect(calls).toHaveLength(0);
  });
});
