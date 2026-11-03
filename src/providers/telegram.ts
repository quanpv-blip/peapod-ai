// Telegram Bot API: gửi thông báo vào nhóm, và gọi các phương thức khác (getUpdates, sendMessage có nút, answerCallbackQuery).
// Token là bí mật: không ghi vào log hay thông báo lỗi.
// Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID thì thông báo bị bỏ qua (không lỗi). Gửi lỗi không làm hỏng luồng nghiệp vụ.

const MAX_TEXT = 4096; // giới hạn một tin của Telegram

export interface TelegramTarget {
  token: string | undefined;
  chatId: string | undefined;
}

export function telegramFromEnv(env: NodeJS.ProcessEnv = process.env): TelegramTarget {
  return { token: env.TELEGRAM_BOT_TOKEN?.trim() || undefined, chatId: env.TELEGRAM_CHAT_ID?.trim() || undefined };
}

export async function notifyTelegram(text: string, target: TelegramTarget = telegramFromEnv(), fetchFn: typeof fetch = fetch): Promise<boolean> {
  if (!target.token || !target.chatId) return false;
  const r = await tgCall<unknown>(target.token, 'sendMessage', { chat_id: target.chatId, text: text.slice(0, MAX_TEXT), disable_web_page_preview: true }, { fetchFn });
  return r.ok;
}

/** Nút bấm trong tin nhắn: `callback` gửi lại cho bot, `url` mở trang web. */
export type InlineButton = { text: string; callback_data: string } | { text: string; url: string };

export interface TgUpdate {
  update_id: number;
  message?: { message_id: number; chat: { id: number; type: string }; from?: { id: number; first_name?: string; username?: string }; text?: string };
  callback_query?: { id: string; from: { id: number; first_name?: string }; data?: string; message?: { chat: { id: number; type: string } } };
}

export interface TgResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

/** Gọi một phương thức Bot API. Lỗi mạng hoặc HTTP được trả về dạng `ok: false`, không ném ra. Không ghi token vào mô tả lỗi. */
export async function tgCall<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
  opts: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<TgResponse<T>> {
  try {
    const res = await (opts.fetchFn ?? fetch)(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    });
    const json = (await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))) as TgResponse<T>;
    return json.ok ? json : { ok: false, description: json.description ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, description: (e as Error).name === 'TimeoutError' ? 'hết thời gian chờ' : 'lỗi mạng' };
  }
}

export function sendTelegram(token: string, chatId: number | string, text: string, buttons?: InlineButton[][]): Promise<TgResponse<unknown>> {
  return tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text: text.slice(0, MAX_TEXT),
    disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  });
}
