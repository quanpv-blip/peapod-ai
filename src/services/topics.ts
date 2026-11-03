// Đề xuất chủ đề bài đăng từ kho tin RSS gần đây. AI đề xuất nếu có khóa; không có thì dùng danh sách tin mới nhất.
// Mọi URL trong đề xuất phải nằm trong kho tin (kiểm tra lại ở ứng dụng, không tin hoàn toàn vào mô hình).
import type pg from 'pg';
import { SUGGEST_RULES, SUGGEST_SCHEMA, suggestUserPrompt } from '../domain/editorial.ts';
import { sanitize } from '../domain/sanitizer.ts';
import type { Market } from '../domain/package.ts';
import type { GeminiClient } from '../providers/gemini.ts';
import { getAppSettings } from './appSettings.ts';
import { capCheck, estimateCost, recordUsage } from './costs.ts';
import { recentItems, type SourceItem } from './sources.ts';

export interface TopicSuggestion {
  title: string;
  reason: string;
  urls: string[];
}

export interface SuggestResult {
  topics: TopicSuggestion[];
  /** 'ai' khi mô hình đề xuất; 'tin-mới' khi rơi về danh sách tin mới nhất; 'trống' khi không có tin. */
  source: 'ai' | 'tin-mới' | 'trống';
  items: SourceItem[];
  /** Lý do AI không dùng được (khi rơi về danh sách tin mới), để hiển thị cho người dùng. */
  aiNote?: string;
}

export interface SuggestDeps {
  db: pg.Pool;
  gemini?: GeminiClient;
  model: string;
  now?: () => Date;
}

export async function suggestTopics(deps: SuggestDeps, market: Market): Promise<SuggestResult> {
  const now = deps.now?.() ?? new Date();
  const items = await recentItems(deps.db, market, now, 3, 40);
  if (items.length === 0) return { topics: [], source: 'trống', items };

  let aiNote: string | undefined;
  if (deps.gemini) {
    const s = await getAppSettings(deps.db);
    const cap = await capCheck(deps.db, s, now);
    if (!cap.allowed) {
      aiNote = `${cap.reason}. Hiển thị tin mới nhất.`;
    } else {
      try {
        const known = new Set(items.map((i) => i.url));
        const lines = items.map((i) => `${sanitize(i.title).text} — ${i.url}`).join('\n');
        // Schema riêng của đề xuất (không dùng schema bài đăng).
        const gen = await deps.gemini.generateJson({ model: deps.model, system: SUGGEST_RULES, user: suggestUserPrompt(market, lines), schema: SUGGEST_SCHEMA as unknown as object });
        const cost = estimateCost({ inputTokens: gen.usage.inputTokens, outputTokens: gen.usage.outputTokens, thoughtTokens: gen.usage.thoughtTokens }, s);
        await recordUsage(deps.db, { market, purpose: 'NEWS', model: gen.model ?? deps.model, usage: gen.usage, costUsd: cost });
        const topics = validTopics((gen.json as { topics?: unknown }).topics, known);
        if (topics.length > 0) return { topics, source: 'ai', items };
        aiNote = 'AI không trả về chủ đề hợp lệ. Hiển thị tin mới nhất.';
      } catch (e) {
        // AI lỗi (hết hạn mức, quá tải, quá chậm) không được làm hỏng trang: báo lý do và rơi về tin mới nhất.
        aiNote = `${(e as Error).message.slice(0, 200)}. Hiển thị tin mới nhất.`;
      }
    }
  }
  // Rơi về: mỗi tin mới nhất là một chủ đề (không cần AI).
  const topics = items.slice(0, 6).map((i) => ({ title: i.title, reason: 'Tin mới nhất trong nguồn đã cấu hình', urls: [i.url] }));
  return { topics, source: 'tin-mới', items, aiNote };
}

/** Lọc đề xuất của mô hình: chỉ giữ URL có trong kho; bỏ chủ đề không còn URL hợp lệ. */
export function validTopics(raw: unknown, known: Set<string>): TopicSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: TopicSuggestion[] = [];
  for (const t of raw) {
    const o = t as { title?: unknown; reason?: unknown; urls?: unknown };
    if (typeof o.title !== 'string' || typeof o.reason !== 'string' || !Array.isArray(o.urls)) continue;
    const urls = [...new Set(o.urls.filter((u): u is string => typeof u === 'string' && known.has(u)))].slice(0, 3);
    if (urls.length === 0) continue;
    out.push({ title: o.title.trim().slice(0, 80), reason: o.reason.trim().slice(0, 200), urls });
    if (out.length >= 6) break;
  }
  return out;
}
