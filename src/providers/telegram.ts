// Thông báo qua Telegram Bot API (sendMessage vào một nhóm). Token là bí mật: không ghi vào log hay thông báo lỗi.
// Thiếu TELEGRAM_BOT_TOKEN hoặc TELEGRAM_CHAT_ID thì bỏ qua (không lỗi). Gửi lỗi không làm hỏng luồng nghiệp vụ.

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
  try {
    const res = await fetchFn(`https://api.telegram.org/bot${target.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: target.chatId, text: text.slice(0, MAX_TEXT), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
