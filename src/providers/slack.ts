// Thông báo qua Slack (incoming webhook). Địa chỉ webhook là bí mật: không ghi vào log hay thông báo lỗi.
// Thiếu SLACK_WEBHOOK_URL thì mọi thông báo bị bỏ qua (không lỗi). Gửi lỗi không làm hỏng luồng nghiệp vụ.

export async function notifySlack(text: string, url: string | undefined = process.env.SLACK_WEBHOOK_URL): Promise<boolean> {
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 3000) }),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
