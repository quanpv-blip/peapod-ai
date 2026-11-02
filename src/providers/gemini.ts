import { requireEnv } from '../config.ts';
import { requestJson } from './http.ts';

// Bộ chuyển đổi Gemini qua Interactions API (docs/99 E-19..E-22). Hình dạng phản hồi đã kiểm bằng poc/gemini-probe.ts
// (2026-11-02): `steps[]` gồm `thought` (bỏ qua) và `model_output` với `content[]` kiểu text hoặc audio (WAV base64).

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Gemini không nêu hỗ trợ `oneOf`/`const` và KHÔNG ép `maxLength` (E-21). Chuyển: oneOf -> anyOf, const -> enum một phần tử,
 * bỏ `$comment`. Ràng buộc độ dài vẫn nằm trong schema nhưng phải do validator của ứng dụng đảm bảo (FR-GEN-03).
 */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === '$comment') continue;
      if (k === 'oneOf') out.anyOf = toGeminiSchema(v);
      else if (k === 'const') out.enum = [v];
      else out[k] = toGeminiSchema(v);
    }
    return out;
  }
  return schema;
}

export interface GeminiUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
}

interface Interaction {
  status?: string;
  usage?: { total_input_tokens?: number; total_output_tokens?: number; total_thought_tokens?: number };
  steps?: { type: string; content?: { type: string; text?: string; data?: string; mime_type?: string }[] }[];
}

function usageOf(i: Interaction): GeminiUsage {
  return {
    inputTokens: i.usage?.total_input_tokens ?? 0,
    outputTokens: i.usage?.total_output_tokens ?? 0,
    thoughtTokens: i.usage?.total_thought_tokens ?? 0,
  };
}

export function extractText(i: Interaction): string {
  const parts = (i.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string);
  return parts.join('');
}

export function extractAudio(i: Interaction): { data: Buffer; mimeType: string } | undefined {
  const a = (i.steps ?? [])
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .find((c) => c.type === 'audio' && c.data);
  return a?.data ? { data: Buffer.from(a.data, 'base64'), mimeType: a.mime_type ?? 'audio/wav' } : undefined;
}

export interface GeminiClient {
  generateJson(args: { model: string; system: string; user: string; schema: object }): Promise<{ text: string; json: unknown; usage: GeminiUsage; raw: unknown }>;
  tts(args: { model: string; text: string; voice?: string }): Promise<{ wav: Buffer; usage: GeminiUsage }>;
}

export function createGeminiClient(env: NodeJS.ProcessEnv = process.env): GeminiClient {
  const headers = { 'x-goog-api-key': requireEnv('GEMINI_API_KEY', env) };

  return {
    async generateJson({ model, system, user, schema }) {
      // Chưa xác nhận tên trường system instruction của Interactions API: ghép vào đầu `input` (⚠️ thử ở PoC sau).
      const res = await requestJson<Interaction>(`${BASE}/interactions`, {
        headers,
        idempotent: true,
        timeoutMs: 120_000,
        body: {
          model,
          input: `${system}\n\n---\n\n${user}`,
          response_format: { type: 'text', mime_type: 'application/json', schema: toGeminiSchema(schema) },
        },
      });
      const text = extractText(res.json);
      let json: unknown = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* để validator ở tầng trên báo lỗi */
      }
      return { text, json, usage: usageOf(res.json), raw: res.json };
    },

    async tts({ model, text, voice }) {
      const res = await requestJson<Interaction>(`${BASE}/interactions`, {
        headers,
        idempotent: true,
        timeoutMs: 120_000,
        body: {
          model,
          input: text,
          response_format: { type: 'audio' },
          ...(voice ? { generation_config: { speech_config: [{ voice }] } } : {}),
        },
      });
      const audio = extractAudio(res.json);
      if (!audio) throw new Error('Gemini TTS không trả âm thanh');
      return { wav: audio.data, usage: usageOf(res.json) };
    },
  };
}
