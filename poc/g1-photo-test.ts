// G-1 (ảnh): đăng thử một ẢNH thẻ HẸN GIỜ lên Page thử, thăm dò các trường đối soát, rồi XÓA ngay (kể cả khi thăm dò lỗi). Không in token.
// Chạy: npx tsx poc/g1-photo-test.ts --market VN
import { readFileSync } from 'node:fs';
import { createMetaClient } from '../src/providers/meta.ts';
import { requestJson } from '../src/providers/http.ts';
import { requireEnv } from '../src/config.ts';
import { arg, loadEnv, saveEvidence } from './util.ts';

loadEnv();
const market = arg('market', 'VN').toUpperCase();
const pageId = requireEnv(`FB_${market}_PAGE_ID`);
const token = requireEnv(`FB_${market}_PAGE_TOKEN`);
const meta = createMetaClient();
const g = `https://graph.facebook.com/${meta.version}`;
const bearer = { Authorization: `Bearer ${token}` };
const png = readFileSync('poc/out/card-vn.png');

const at = Math.floor(Date.now() / 1000) + 20 * 60;
const result: Record<string, unknown> = { market, at: new Date().toISOString(), scheduled_for: new Date(at * 1000).toISOString() };
const created = await meta.postPhoto(token, pageId, png, { caption: '[THỬ NGHIỆM ẢNH - SẼ XÓA] PeaPod, G-1. Không phải nội dung thật.', published: false, scheduled_publish_time: at });
const j = created.json as { id?: string; post_id?: string };
result.create = { status: created.status, id: j.id ?? null, post_id: j.post_id ?? null };
console.log(`tạo ảnh hẹn giờ: id=${j.id ?? '-'} post_id=${j.post_id ?? '-'}`);

// Thăm dò: trường nào đọc được cho bài ảnh? Mỗi lệnh bắt lỗi riêng để không dừng giữa chừng.
const probe = async (id: string, fields: string) => {
  try {
    const r = await meta.get(token, id, { fields });
    return { ok: true, json: r.json };
  } catch (e) {
    return { ok: false, error: (e as Error).message.replace(/EAA\S+/g, '[token]').slice(0, 220) };
  }
};
const probes: Record<string, unknown> = {};
for (const [label, id] of [['post_id', j.post_id], ['photo_id', j.id]] as const) {
  if (!id) continue;
  probes[`${label}:is_published`] = await probe(id, 'id,is_published');
  probes[`${label}:created_time`] = await probe(id, 'id,created_time');
}
result.probes = probes;
console.log('thăm dò:', JSON.stringify(probes).replace(/EAA\S+/g, '[token]').slice(0, 600));

// Xóa mọi đối tượng đã tạo, kể cả khi thăm dò lỗi.
const deletes: Record<string, unknown> = {};
for (const id of [j.post_id, j.id].filter((x): x is string => !!x)) {
  try {
    const del = await requestJson(`${g}/${id}`, { method: 'DELETE', headers: bearer, idempotent: true });
    deletes[id] = { status: del.status, success: (del.json as { success?: boolean }).success === true };
  } catch (e) {
    deletes[id] = { error: (e as Error).message.replace(/EAA\S+/g, '[token]').slice(0, 160) };
  }
}
result.deletes = deletes;
console.log('xóa:', JSON.stringify(deletes));
console.log('Bằng chứng:', saveEvidence(`g1-photo-test-${market}.json`, result));
