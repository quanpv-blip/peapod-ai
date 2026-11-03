// Vòng lặp nhận cập nhật từ Telegram (long polling). Vị trí đã đọc được lưu trong app_config để khởi động lại không xử lý lại tin cũ.
// Không cần địa chỉ HTTPS công khai. Chỉ chạy một tiến trình worker; hai tiến trình cùng gọi getUpdates sẽ tranh nhau.
import type pg from 'pg';
import { getFlag, setFlag } from '../services/appSettings.ts';
import { tgCall, type TgUpdate } from '../providers/telegram.ts';

export const TG_OFFSET_KEY = 'tg_offset';

export interface PollOptions {
  db: pg.Pool;
  token: string;
  handle: (u: TgUpdate) => Promise<void>;
  isStopped: () => boolean;
  log?: (msg: string) => void;
  /** Thời gian chờ giữa hai lần gọi khi lỗi (ms). */
  retryMs?: number;
}

export async function pollTelegram(o: PollOptions): Promise<void> {
  const log = o.log ?? ((m: string) => console.log(m));
  let offset = Number((await getFlag(o.db, TG_OFFSET_KEY)) ?? 0);
  while (!o.isStopped()) {
    const r = await tgCall<TgUpdate[]>(
      o.token,
      'getUpdates',
      { offset: offset || undefined, timeout: 25, allowed_updates: ['message', 'callback_query'] },
      { timeoutMs: 35_000 },
    );
    if (!r.ok) {
      log(JSON.stringify({ level: 'warn', msg: 'telegram getUpdates lỗi', detail: r.description ?? '' }));
      await new Promise((res) => setTimeout(res, o.retryMs ?? 5_000));
      continue;
    }
    for (const u of r.result ?? []) {
      try {
        await o.handle(u);
      } catch (e) {
        log(JSON.stringify({ level: 'error', msg: 'telegram xử lý lệnh lỗi', error: (e as Error).message.slice(0, 200) }));
      }
      offset = u.update_id + 1;
      await setFlag(o.db, TG_OFFSET_KEY, String(offset), 'system:telegram');
    }
  }
}
