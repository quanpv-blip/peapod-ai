// Cảnh báo vận hành gửi đồng thời qua mọi kênh đã cấu hình (Slack, Telegram). Kênh nào lỗi không ảnh hưởng kênh kia.
import { notifySlack } from '../providers/slack.ts';
import { notifyTelegram } from '../providers/telegram.ts';

export interface AlertResult {
  slack: boolean;
  telegram: boolean;
}

export async function notifyAll(text: string): Promise<AlertResult> {
  const [slack, telegram] = await Promise.all([notifySlack(text), notifyTelegram(text)]);
  return { slack, telegram };
}
