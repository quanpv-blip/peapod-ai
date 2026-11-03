// Bot Telegram cho người được cấp quyền: menu, xem hàng chờ, xem lịch đăng sắp tới, tạo bài theo chủ đề.
// Duyệt, sửa và hẹn giờ vẫn làm trên web. Chỉ Telegram ID trong TELEGRAM_ALLOWED_USER_IDS được dùng lệnh.
import type pg from 'pg';
import type { Market } from '../domain/package.ts';
import { sendTelegram, tgCall, type InlineButton, type TgUpdate } from '../providers/telegram.ts';

export interface BotDeps {
  db: pg.Pool;
  token: string;
  allowed: Set<number>;
  /** Địa chỉ web (APP_BASE_URL), dùng để gắn liên kết tới từng bài. */
  appUrl: string;
  /** Tạo bài theo chủ đề và trả về nội dung trả lời. Null khi chưa có khóa AI. */
  createTopic: ((market: Market, topic: string) => Promise<string>) | null;
  now?: () => Date;
}

const ZONE: Record<Market, string> = { VN: 'Asia/Ho_Chi_Minh', JP: 'Asia/Tokyo' };
const LABEL: Record<Market, string> = { VN: 'ICT', JP: 'JST' };

/** Danh sách Telegram ID được phép, phân tách bằng dấu phẩy. Bỏ qua giá trị không hợp lệ. */
export function parseAllowlist(raw: string | undefined): Set<number> {
  return new Set((raw ?? '').split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0));
}

/** Tách lệnh dạng `/lenh@tenbot tham số`. Trả về null nếu không phải lệnh. */
export function parseCommand(text: string): { cmd: string; args: string } | null {
  const m = /^\/([a-z_]+)(?:@\w+)?\s*([\s\S]*)$/i.exec(text.trim());
  return m ? { cmd: m[1]!.toLowerCase(), args: m[2]!.trim() } : null;
}

function menuButtons(appUrl: string): InlineButton[][] {
  const rows: InlineButton[][] = [
    [{ text: '📋 Chờ duyệt', callback_data: 'pending' }, { text: '🗓️ Sắp đăng', callback_data: 'upcoming' }],
    [{ text: '✍️ Tạo bài mới', callback_data: 'help_create' }],
  ];
  if (appUrl.startsWith('https://')) rows.push([{ text: '🌐 Mở trang web', url: appUrl }]);
  return rows;
}

const MENU_TEXT = 'PeaPod AI, chọn một chức năng:\n• Chờ duyệt: các bài đang chờ người duyệt.\n• Sắp đăng: các bài đã duyệt, xếp theo giờ đăng.\n• Tạo bài: gõ /tao kèm chủ đề, ví dụ /tao VN Chip AI bán dẫn Việt Nam.';
const CREATE_HELP = 'Gõ /tao kèm chủ đề để tạo bài. Ví dụ:\n/tao Chip AI bán dẫn Việt Nam\n/tao JP 半導体の新工場\nKhông ghi thị trường thì mặc định VN. Việc tạo mất 20–60 giây.';

async function listPending(d: BotDeps): Promise<string> {
  const total = Number((await d.db.query<{ n: number }>("SELECT count(*)::int AS n FROM content_item WHERE state = 'IN_REVIEW'")).rows[0]!.n);
  if (total === 0) return '📋 Không có bài nào đang chờ duyệt.';
  const r = await d.db.query<{ id: string; market: Market; headline: string | null; updated_at: Date }>(
    `SELECT i.id, i.market, i.updated_at, r.package->'post'->>'headline' AS headline
       FROM content_item i JOIN content_revision r ON r.content_id = i.id AND r.revision = i.current_revision
      WHERE i.state = 'IN_REVIEW' ORDER BY i.updated_at DESC LIMIT 10`);
  const lines = r.rows.map((x) => `#${x.id} [${x.market}] ${x.headline ?? '(không có tiêu đề)'}\n${d.appUrl}/contents/${x.id}`);
  return `📋 Chờ duyệt: ${total} bài (hiển thị ${r.rows.length} bài mới nhất)\n\n${lines.join('\n\n')}`;
}

async function listUpcoming(d: BotDeps): Promise<string> {
  const r = await d.db.query<{ id: string; market: Market; scheduled_at: Date | null; headline: string | null; state: string }>(
    `SELECT i.id, i.market, i.state, i.scheduled_at, r.package->'post'->>'headline' AS headline
       FROM content_item i JOIN content_revision r ON r.content_id = i.id AND r.revision = i.current_revision
      WHERE i.state IN ('APPROVED', 'SCHEDULED') ORDER BY i.scheduled_at NULLS LAST, i.id LIMIT 10`);
  if (r.rows.length === 0) return '🗓️ Chưa có bài nào được duyệt hoặc hẹn giờ.';
  const lines = r.rows.map((x) => {
    const when = x.scheduled_at
      ? `${new Intl.DateTimeFormat('vi-VN', { timeZone: ZONE[x.market], day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(x.scheduled_at)} ${LABEL[x.market]}`
      : 'chưa đặt giờ';
    const tag = x.state === 'SCHEDULED' ? 'đã hẹn' : 'đã duyệt';
    return `#${x.id} [${x.market}] ${when} · ${tag}\n${x.headline ?? '(không có tiêu đề)'}\n${d.appUrl}/contents/${x.id}`;
  });
  return `🗓️ Sắp đăng (tối đa 10 bài):\n\n${lines.join('\n\n')}`;
}

async function startCreate(d: BotDeps, chatId: number, args: string): Promise<void> {
  const parts = args.split(/\s+/);
  const market: Market = parts[0]?.toUpperCase() === 'JP' ? 'JP' : 'VN';
  const topic = (parts[0]?.toUpperCase() === 'VN' || parts[0]?.toUpperCase() === 'JP' ? parts.slice(1) : parts).join(' ').trim();
  if (topic.length < 3) return void (await sendTelegram(d.token, chatId, CREATE_HELP));
  if (!d.createTopic) return void (await sendTelegram(d.token, chatId, 'Chưa cấu hình khóa Gemini nên không tạo được bài.'));
  await sendTelegram(d.token, chatId, `⏳ Đang tạo bài ${market} về: "${topic.slice(0, 60)}". Việc này mất 20–60 giây.`);
  // Chạy nền để không chặn vòng lặp nhận lệnh.
  void d.createTopic(market, topic)
    .then((text) => sendTelegram(d.token, chatId, text))
    .catch(() => sendTelegram(d.token, chatId, '⚠️ Tạo bài thất bại. Thử lại sau hoặc kiểm tra trang web.'));
}

/** Xử lý một cập nhật từ Telegram. Lệnh không quen được bỏ qua để không trả lời lạc trong nhóm. */
export async function handleUpdate(d: BotDeps, u: TgUpdate): Promise<void> {
  const from = u.message?.from ?? u.callback_query?.from;
  const chatId = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
  if (!from || chatId === undefined) return;

  let cmd: string;
  let args = '';
  if (u.callback_query) {
    await tgCall(d.token, 'answerCallbackQuery', { callback_query_id: u.callback_query.id });
    cmd = { pending: 'pending', upcoming: 'upcoming', menu: 'start', help_create: 'help_create' }[u.callback_query.data ?? ''] ?? '';
  } else {
    const parsed = parseCommand(u.message?.text ?? '');
    if (!parsed) return;
    cmd = parsed.cmd;
    args = parsed.args;
  }
  if (!cmd) return;

  if (!d.allowed.has(from.id)) {
    // Người chưa được cấp quyền chỉ nhận một hướng dẫn, kèm ID để quản trị viên thêm vào danh sách.
    if (cmd === 'start') await sendTelegram(d.token, chatId, `Bạn chưa được cấp quyền dùng bot PeaPod. ID của bạn: ${from.id}. Nhờ quản trị viên thêm ID này vào TELEGRAM_ALLOWED_USER_IDS.`);
    return;
  }

  switch (cmd) {
    case 'start':
    case 'menu':
      await sendTelegram(d.token, chatId, MENU_TEXT, menuButtons(d.appUrl));
      return;
    case 'pending':
      await sendTelegram(d.token, chatId, await listPending(d), menuButtons(d.appUrl));
      return;
    case 'upcoming':
      await sendTelegram(d.token, chatId, await listUpcoming(d), menuButtons(d.appUrl));
      return;
    case 'help_create':
      await sendTelegram(d.token, chatId, CREATE_HELP);
      return;
    case 'tao':
      await startCreate(d, chatId, args);
      return;
    default:
      return;
  }
}
