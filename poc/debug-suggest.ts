// Gỡ lỗi đề xuất chủ đề: in phản hồi thô của mô hình (không in khóa) và số URL hợp lệ.
import { createPool } from '../src/db.ts';
import { requireEnv } from '../src/config.ts';
import { createGeminiClient } from '../src/providers/gemini.ts';
import { SUGGEST_RULES, SUGGEST_SCHEMA, suggestUserPrompt } from '../src/domain/editorial.ts';
import { recentItems } from '../src/services/sources.ts';
import { sanitize } from '../src/domain/sanitizer.ts';
import { validTopics } from '../src/services/topics.ts';

if (process.env.NODE_ENV !== 'production') process.loadEnvFile('.env');
const pool = createPool(requireEnv('DATABASE_URL'));
try {
  const items = await recentItems(pool, 'VN', new Date(), 3, 40);
  const known = new Set(items.map((i) => i.url));
  const lines = items.map((i) => `${sanitize(i.title).text} — ${i.url}`).join('\n');
  const gen = await createGeminiClient().generateJson({ model: 'gemini-3.6-flash', system: SUGGEST_RULES, user: suggestUserPrompt('VN', lines), schema: SUGGEST_SCHEMA as unknown as object });
  console.log('raw:', JSON.stringify(gen.json).slice(0, 700));
  console.log('known urls:', known.size, 'valid topics:', validTopics((gen.json as { topics?: unknown }).topics, known).length);
} finally {
  await pool.end();
}
