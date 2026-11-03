import { readFile } from 'node:fs/promises';
import { requireEnv } from '../config.ts';
import { requestJson, type JsonResponse } from './http.ts';
import { HttpError } from '../domain/retry.ts';

// Bộ chuyển đổi Meta Graph API. Hợp đồng ✅ ở ba-team/docs/04 mục 3 (Reels) ; điều ⚠️ kiểm ở PoC G-1.
// Token luôn đi qua header (không đặt vào URL để khỏi lọt vào log).

export interface MetaClient {
  version: string;
  debugToken(inputToken: string): Promise<JsonResponse>;
  get(pageToken: string, path: string, query?: Record<string, string>): Promise<JsonResponse>;
  /** Tạo bài văn bản. idempotent=false: không tự thử lại (FR-PUB-03). */
  postFeed(pageToken: string, pageId: string, body: { message: string; link?: string; published?: boolean; scheduled_publish_time?: number }): Promise<JsonResponse>;
  /** Đăng ảnh (PNG) kèm chú thích, hẹn giờ được. Multipart; idempotent=false: không tự thử lại. */
  postPhoto(pageToken: string, pageId: string, png: Buffer, body: { caption: string; published?: boolean; scheduled_publish_time?: number }): Promise<JsonResponse>;
  /** Xóa một bài (kể cả bài hẹn giờ). Idempotent: xóa lại bài đã xóa không gây hại; lỗi được báo lên, không đoán. */
  deletePost(pageToken: string, postId: string): Promise<JsonResponse>;
  reelsStart(pageToken: string, pageId: string): Promise<JsonResponse<{ video_id: string; upload_url: string }>>;
  /** Bước 2: máy chủ rupload dùng `Authorization: OAuth` (KHÔNG Bearer). */
  reelsUpload(pageToken: string, uploadUrl: string, filePath: string): Promise<JsonResponse>;
  reelsStatus(pageToken: string, videoId: string): Promise<JsonResponse>;
  reelsFinish(
    pageToken: string,
    pageId: string,
    args: { videoId: string; state: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED'; description: string; isAiGenerated: boolean; scheduledPublishTime?: number },
  ): Promise<JsonResponse>;
}

export function createMetaClient(env: NodeJS.ProcessEnv = process.env): MetaClient {
  const version = env.META_GRAPH_VERSION ?? 'v26.0';
  const g = `https://graph.facebook.com/${version}`;
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

  return {
    version,

    debugToken(inputToken) {
      const appToken = `${requireEnv('META_APP_ID', env)}|${requireEnv('META_APP_SECRET', env)}`;
      return requestJson(`${g}/debug_token?input_token=${encodeURIComponent(inputToken)}`, { headers: bearer(appToken), idempotent: true });
    },

    get(pageToken, path, query = {}) {
      const qs = new URLSearchParams(query).toString();
      return requestJson(`${g}/${path.replace(/^\//, '')}${qs ? `?${qs}` : ''}`, { headers: bearer(pageToken), idempotent: true });
    },

    postFeed: (pageToken, pageId, body) => requestJson(`${g}/${pageId}/feed`, { headers: bearer(pageToken), body, idempotent: false }),

    async postPhoto(pageToken, pageId, png, body) {
      // Tạo bài: không dùng requestJson (vốn tự thử lại khi idempotent). Một lần gọi, lỗi báo ngay.
      const form = new FormData();
      form.set('caption', body.caption);
      form.set('published', String(body.published ?? true));
      if (body.scheduled_publish_time) form.set('scheduled_publish_time', String(body.scheduled_publish_time));
      form.set('source', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'card.png');
      const res = await fetch(`${g}/${pageId}/photos`, { method: 'POST', headers: bearer(pageToken), body: form, signal: AbortSignal.timeout(60_000) });
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} /photos: ${text.slice(0, 300)}`);
      return { status: res.status, json: JSON.parse(text) as unknown, headers: res.headers };
    },

    deletePost: (pageToken, postId) => requestJson(`${g}/${postId}`, { method: 'DELETE', headers: bearer(pageToken), idempotent: true }),

    reelsStart: (pageToken, pageId) =>
      requestJson(`${g}/${pageId}/video_reels`, { headers: bearer(pageToken), body: { upload_phase: 'start' }, idempotent: false }),

    async reelsUpload(pageToken, uploadUrl, filePath) {
      const buf = await readFile(filePath);
      const res = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${pageToken}`,
          offset: '0',
          file_size: String(buf.byteLength),
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array(buf),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`rupload HTTP ${res.status}: ${text.slice(0, 300)}`);
      return { status: res.status, json: text ? JSON.parse(text) : null, headers: res.headers };
    },

    reelsStatus: (pageToken, videoId) => requestJson(`${g}/${videoId}?fields=status`, { headers: bearer(pageToken), idempotent: true }),

    reelsFinish: (pageToken, pageId, a) =>
      requestJson(`${g}/${pageId}/video_reels`, {
        headers: bearer(pageToken),
        idempotent: false,
        body: {
          upload_phase: 'finish',
          video_id: a.videoId,
          video_state: a.state,
          description: a.description,
          is_ai_generated: a.isAiGenerated,
          ...(a.scheduledPublishTime ? { scheduled_publish_time: a.scheduledPublishTime } : {}),
        },
      }),
  };
}
