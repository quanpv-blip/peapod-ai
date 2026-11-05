// Viết lại bài bằng AI theo hướng người duyệt chọn (hấp dẫn hơn, ngắn hơn, sâu hơn, nhấn mạnh tác động).
// Kết quả là một revision mới do chính người bấm nút lưu (saveEdit), nên mọi quy tắc duyệt vẫn áp dụng: bài về lại "Chờ duyệt".
// Chỉ lấy phần "post" từ AI; nguồn, khẳng định cần kiểm và media giữ nguyên từ bài gốc, nên không thể thêm nguồn lạ.
import type pg from 'pg';
import type { Actor } from '../auth.ts';
import { languageMatchesMarket, validatePackage, type ContentPackage } from '../domain/package.ts';
import { NEWS_EXAMPLE, NEWS_VOICE, REWRITE_RULES, rewriteUserPrompt, type RewriteStyle } from '../domain/editorial.ts';
import { polishPackage } from '../domain/polish.ts';
import { sanitize } from '../domain/sanitizer.ts';
import type { GeminiClient } from '../providers/gemini.ts';
import { getAppSettings } from './appSettings.ts';
import { capCheck, estimateCost, recordUsage } from './costs.ts';
import { AppError, getContent, saveEdit } from './contents.ts';
import { isPaused } from './settings.ts';

// Tiếng Việt có dấu thanh/dấu mũ: bài tiếng Anh viết không dấu sẽ không đạt ngưỡng này (languageMatchesMarket chỉ loại tiếng Nhật khỏi VN).
const VI_MARKS = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/giu;
export function looksVietnamese(text: string): boolean {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  return letters > 0 && (text.match(VI_MARKS)?.length ?? 0) / letters >= 0.05;
}

export interface RewriteDeps {
  db: pg.Pool;
  gemini: GeminiClient;
  schema: object;
  model: string;
}

/** Viết lại bài #id; trả về số revision mới. Ném AppError với thông điệp tiếng Việt khi không làm được. */
export async function rewritePost(deps: RewriteDeps, actor: Actor, id: number, style: RewriteStyle): Promise<number> {
  const d = await getContent(deps.db, actor, id);
  if (await isPaused(deps.db)) throw new AppError('CONFLICT', 'Công tắc tạm dừng đang bật: không gọi AI.');
  const s = await getAppSettings(deps.db);
  const cap = await capCheck(deps.db, s);
  if (!cap.allowed) throw new AppError('CONFLICT', cap.reason!);

  const market = d.item.market;
  const orig = d.package;
  // Nội dung bài gốc đi qua bộ lọc chống chèn lệnh như mọi dữ liệu đưa vào prompt.
  const post = { ...orig.post, headline: sanitize(orig.post.headline).text, body: sanitize(orig.post.body).text };
  let gen;
  try {
    gen = await deps.gemini.generateJson({
      model: deps.model,
      system: `${REWRITE_RULES}\n\n${NEWS_VOICE[market]}\n\n${NEWS_EXAMPLE[market]}`,
      user: rewriteUserPrompt(market, style, post, orig.sources),
      schema: deps.schema,
    });
  } catch (e) {
    throw new AppError('CONFLICT', `Không gọi được AI: ${(e as Error).message.slice(0, 120)}`);
  }
  await recordUsage(deps.db, { market, purpose: 'NEWS', model: gen.model ?? deps.model, usage: gen.usage, costUsd: estimateCost(gen.usage, s) });

  const v = validatePackage(gen.json);
  if (!v.ok) throw new AppError('INVALID', `AI trả về nội dung không hợp lệ: ${v.errors[0]}`);
  const next: ContentPackage = polishPackage({ ...orig, post: v.value.post });
  if (!languageMatchesMarket(next.post.body, market)) throw new AppError('INVALID', 'AI viết sai ngôn ngữ của thị trường, hãy thử lại.');
  if (market === 'VN' && !looksVietnamese(next.post.body)) throw new AppError('INVALID', 'AI viết sai ngôn ngữ của thị trường, hãy thử lại.');
  if (next.post.body.trim() === orig.post.body.trim() && next.post.headline === orig.post.headline) throw new AppError('INVALID', 'AI không thay đổi gì so với bản hiện tại, hãy chọn hướng chỉnh khác.');

  return saveEdit(deps.db, actor, id, d.item.current_revision, { headline: next.post.headline, body: next.post.body, call_to_action: next.post.call_to_action, hashtags: next.post.hashtags });
}
