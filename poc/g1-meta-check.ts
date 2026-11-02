// G-1 (phần chỉ đọc, an toàn): kiểm tra token, quyền, liệt kê bài, số đếm cơ bản và metric Insights còn hợp lệ.
// Chạy: npx tsx poc/g1-meta-check.ts --market VN
import { createMetaClient } from '../src/providers/meta.ts';
import { requireEnv } from '../src/config.ts';
import { arg, loadEnv, saveEvidence } from './util.ts';

loadEnv();
const market = arg('market', 'VN').toUpperCase();
const pageId = requireEnv(`FB_${market}_PAGE_ID`);
const token = requireEnv(`FB_${market}_PAGE_TOKEN`);
const meta = createMetaClient();

const result: Record<string, unknown> = { market, version: meta.version, at: new Date().toISOString() };
const attempt = async (name: string, fn: () => Promise<unknown>) => {
  try {
    result[name] = { ok: true, data: await fn() };
  } catch (e) {
    result[name] = { ok: false, error: (e as Error).message.slice(0, 300) };
  }
  console.log(`${(result[name] as { ok: boolean }).ok ? 'OK  ' : 'FAIL'} ${name}`);
};

await attempt('debug_token', async () => {
  const d = (await meta.debugToken(token)).json as { data?: Record<string, unknown> };
  return { type: d.data?.type, is_valid: d.data?.is_valid, expires_at: d.data?.expires_at, scopes: d.data?.scopes };
});
await attempt('page', async () => (await meta.get(token, pageId, { fields: 'id,name,fan_count' })).json);

let postId: string | undefined;
for (const edge of ['published_posts', 'posts']) {
  await attempt(`list_${edge}`, async () => {
    const j = (await meta.get(token, `${pageId}/${edge}`, { fields: 'id,created_time', limit: '5' })).json as { data?: { id: string }[] };
    postId ??= j.data?.[0]?.id;
    return { count: j.data?.length ?? 0 };
  });
}

if (postId) {
  await attempt('basic_counts', async () =>
    (await meta.get(token, postId!, { fields: 'reactions.summary(true).limit(0),comments.summary(true).limit(0),shares' })).json,
  );
  // E-08: thăm dò từng metric riêng để biết cái nào còn hợp lệ.
  const metrics = ['post_impressions_unique', 'post_engaged_users', 'post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_reactions_by_type_total'];
  const probe: Record<string, string> = {};
  for (const m of metrics) {
    try {
      await meta.get(token, `${postId}/insights`, { metric: m });
      probe[m] = 'OK';
    } catch (e) {
      probe[m] = (e as Error).message.slice(0, 120);
    }
  }
  result.metric_probe = probe;
  console.table(probe);
}

console.log('Bằng chứng:', saveEvidence(`g1-meta-check-${market}.json`, result));
