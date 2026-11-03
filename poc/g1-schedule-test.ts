// G-1 (phần ghi, có xác nhận): đăng thử một bài HẸN GIỜ lên Page thử, kiểm tra, rồi xóa.
// Bài không bao giờ tới giờ đăng vì bị xóa trong cùng lượt chạy. Không in token.
// Chạy: npx tsx poc/g1-schedule-test.ts --market VN
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

// Meta yêu cầu hẹn giờ > 10 phút; đặt 20 phút để có thời gian xóa trước giờ đăng.
const at = Math.floor(Date.now() / 1000) + 20 * 60;
const message = '[THỬ NGHIỆM KỸ THUẬT - SẼ XÓA] PeaPod, G-1. Không phải nội dung thật.';
const result: Record<string, unknown> = { market, at: new Date().toISOString(), scheduled_for: new Date(at * 1000).toISOString() };

const created = await meta.postFeed(token, pageId, { message, published: false, scheduled_publish_time: at });
const postId = (created.json as { id?: string }).id;
result.create = { ok: !!postId, status: created.status };
console.log(postId ? 'OK   tạo bài hẹn giờ' : `FAIL tạo bài hẹn giờ (HTTP ${created.status})`);

if (postId) {
  try {
    const check = await meta.get(token, postId, { fields: 'id,is_published,scheduled_publish_time' });
    result.verify = check.json;
    console.log('OK   đọc lại bài:', JSON.stringify(check.json).replace(/EAA\S+/g, '[token]'));
  } catch (e) {
    result.verify = { error: (e as Error).message.slice(0, 200) };
    console.log('FAIL đọc lại bài');
  }

  const del = await requestJson(`${g}/${postId}`, { method: 'DELETE', headers: bearer, idempotent: true });
  result.delete = { ok: (del.json as { success?: boolean }).success === true, status: del.status };
  console.log(result.delete && (result.delete as { ok: boolean }).ok ? 'OK   đã xóa bài thử' : `FAIL xóa bài thử (HTTP ${del.status}) — xóa thủ công trước ${new Date(at * 1000).toISOString()}`);
}

console.log('Bằng chứng:', saveEvidence(`g1-schedule-test-${market}.json`, result));
