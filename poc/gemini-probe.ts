// Thăm dò hình dạng phản hồi thật của Gemini Interactions API (docs/99 E-19..E-22). Ghi bằng chứng thô vào poc/out/.
// Chạy: npx tsx poc/gemini-probe.ts [model]
import { requireEnv } from '../src/config.ts';
import { loadEnv, saveEvidence } from './util.ts';

loadEnv();
const key = requireEnv('GEMINI_API_KEY');
const model = process.argv[2] ?? 'gemini-3.6-flash';
const URL_ = 'https://generativelanguage.googleapis.com/v1beta/interactions';

async function call(name: string, body: object, timeoutMs = 90_000) {
  const t0 = Date.now();
  try {
    const res = await fetch(URL_, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 800) }; }
    const file = saveEvidence(`gemini-${name}.json`, { status: res.status, ms: Date.now() - t0, request: body, response: json });
    console.log(`${res.ok ? 'OK  ' : 'FAIL'} ${name} HTTP ${res.status} ${Date.now() - t0}ms -> ${file}`);
    if (!res.ok) console.log('     ', JSON.stringify(json).slice(0, 300));
    return json as Record<string, unknown>;
  } catch (e) {
    console.log(`FAIL ${name} ${(e as Error).name} sau ${Date.now() - t0}ms`);
    return {};
  }
}

const schema = {
  type: 'object',
  properties: { greeting_ja: { type: 'string' }, greeting_vi: { type: 'string' } },
  required: ['greeting_ja', 'greeting_vi'],
  additionalProperties: false,
};

await call('1-plain', { model, input: 'Trả lời đúng một câu: xin chào khách hàng doanh nghiệp bằng tiếng Nhật lịch sự (Keigo).' });
await call('2-structured', {
  model,
  input: 'Chào hỏi khách hàng doanh nghiệp bằng tiếng Nhật (Keigo) và tiếng Việt.',
  response_format: { type: 'text', mime_type: 'application/json', schema },
});
await call('3-search', {
  model,
  input: 'Tin tức công nghệ về offshore development Việt Nam – Nhật Bản trong 7 ngày qua. Nêu 3 mục kèm URL nguồn.',
  tools: [{ type: 'google_search' }],
});
await call('4-tts', {
  model: 'gemini-3.8-flash-lite-tts',
  input: '本日はオフショア開発の品質管理についてご紹介いたします。',
  response_format: { type: 'audio' },
});
