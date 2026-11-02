import { requireEnv } from '../config.ts';
import { requestJson, type JsonResponse } from './http.ts';

// Bộ chuyển đổi xAI. Các hợp đồng ✅ trong ba-team/docs/04 mục 2; điều ⚠️ được thu thập thô ở PoC (poc/*.ts).
// Kiểu trả về cố ý lỏng (unknown) cho tới khi G-2/G-4 xác nhận hình dạng phản hồi thật.

export interface XaiClient {
  /** Nghiên cứu: Responses API + công cụ tìm kiếm (docs/04 2.2). Lặp lại an toàn (chỉ đọc, tốn tiền nhưng không đổi trạng thái). */
  research(args: { model: string; prompt: string; tools: { type: string; [k: string]: unknown }[] }): Promise<JsonResponse>;
  /** Sinh nội dung: Chat Completions + json_schema strict, KHÔNG có tools (ADR-04). */
  generate(args: { model: string; system: string; user: string; schemaName: string; schema: object }): Promise<JsonResponse>;
  /** TTS (docs/04 2.5). Trả JSON khi withTimestamps, ngược lại trả byte âm thanh. */
  ttsWithTimestamps(args: { text: string; language: 'ja' | 'vi'; voiceId?: string }): Promise<JsonResponse>;
  ttsAudio(args: { text: string; language: 'ja' | 'vi'; voiceId?: string }): Promise<Uint8Array>;
  /** Tạo video: KHÔNG tự thử lại (tốn tiền) -> idempotent=false. */
  createVideo(args: { model: string; prompt: string; duration: number; extra?: Record<string, unknown> }): Promise<JsonResponse>;
  getVideo(requestId: string): Promise<JsonResponse>;
}

export function createXaiClient(env: NodeJS.ProcessEnv = process.env): XaiClient {
  const base = env.XAI_BASE_URL ?? 'https://api.x.ai/v1';
  const key = requireEnv('XAI_API_KEY', env);
  const auth = { Authorization: `Bearer ${key}` };

  return {
    research: ({ model, prompt, tools }) =>
      requestJson(`${base}/responses`, { body: { model, input: prompt, tools }, headers: auth, idempotent: true, timeoutMs: 180_000 }),

    generate: ({ model, system, user, schemaName, schema }) =>
      requestJson(`${base}/chat/completions`, {
        headers: auth,
        idempotent: true,
        timeoutMs: 120_000,
        body: {
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          response_format: { type: 'json_schema', json_schema: { name: schemaName, schema, strict: true } },
        },
      }),

    ttsWithTimestamps: ({ text, language, voiceId }) =>
      requestJson(`${base}/tts`, {
        headers: auth,
        idempotent: true,
        body: { text, language, voice_id: voiceId, text_normalization: true, with_timestamps: true },
      }),

    async ttsAudio({ text, language, voiceId }) {
      const res = await fetch(`${base}/tts`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, language, voice_id: voiceId, text_normalization: true }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      return new Uint8Array(await res.arrayBuffer());
    },

    createVideo: ({ model, prompt, duration, extra }) =>
      requestJson(`${base}/videos/generations`, { headers: auth, idempotent: false, body: { model, prompt, duration, ...extra } }),

    getVideo: (requestId) => requestJson(`${base}/videos/${encodeURIComponent(requestId)}`, { headers: auth, idempotent: true }),
  };
}
