// G-2: thử nghiên cứu xu hướng bằng web_search + x_search, đếm URL hợp lệ.
// Chạy: npx tsx poc/g2-research.ts --market JP
import { createXaiClient } from '../src/providers/xai.ts';
import { arg, loadEnv, saveEvidence } from './util.ts';

loadEnv();
const market = arg('market', 'JP').toUpperCase();
const model = process.env.XAI_MODEL_RESEARCH ?? 'grok-4.3';
const KEYWORDS: Record<string, string> = {
  JP: 'オフショア開発 ベトナム, システム保守 課題, レガシーシステム 刷新, 生成AI 業務効率化',
  VN: 'chuyển đổi số doanh nghiệp, kiến trúc microservices, giải pháp cloud, tối ưu chi phí vận hành phần mềm, tuyển dụng IT',
};
const prompt = `Tìm tối đa 5 tin/xu hướng trong 24–48 giờ qua về: ${KEYWORDS[market]}.
Với mỗi mục: title, summary (≤ 280 ký tự, diễn đạt lại, không sao chép), url (URL bài gốc có thật), published_at (nếu biết).
Bỏ qua tin không có nguồn xác thực, tin quảng cáo, tin đồn.
Trả về JSON: {"topics":[{"title","summary","url","published_at"}]}.`;

const xai = createXaiClient();
const t0 = Date.now();
const res = await xai.research({ model, prompt, tools: [{ type: 'web_search' }, { type: 'x_search' }] });
const seconds = ((Date.now() - t0) / 1000).toFixed(1);

const text = JSON.stringify(res.json);
const urls = [...new Set(text.match(/https?:\/\/[^\s"\)]+/g) ?? [])].filter((u) => !u.includes('x.ai'));
const checks: { url: string; status: number | string }[] = [];
for (const u of urls.slice(0, 25)) {
  try {
    const r = await fetch(u, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    checks.push({ url: u, status: r.status });
  } catch (e) {
    checks.push({ url: u, status: (e as Error).name });
  }
}
const okCount = checks.filter((c) => typeof c.status === 'number' && c.status < 400).length;
console.log({ model, market, seconds, urlsFound: urls.length, urlsOk: okCount, usage: (res.json as { usage?: unknown }).usage });
console.log('Bằng chứng:', saveEvidence(`g2-research-${market}.json`, { prompt, response: res.json, checks }));
