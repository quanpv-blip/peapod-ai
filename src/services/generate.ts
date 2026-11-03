// Sinh bài có nguồn vào hàng chờ duyệt: bản tin từ RSS (tự động và nút bấm) và bài chiến dịch theo chủ đề.
// Mỗi lượt gọi AI: kiểm trần chi phí trước, ghi chi phí sau, kiểm schema/nguồn/ngôn ngữ, rồi tạo ảnh thẻ.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { languageMatchesMarket, unknownSources, validatePackage, type ContentPackage, type Market } from '../domain/package.ts';
import { NEWS_RULES, NEWS_VOICE, newsUserPrompt, TOPIC_RULES, topicUserPrompt, unusedItems } from '../domain/editorial.ts';
import { campaignSourceAllowed, type AppSettings } from '../domain/appSettings.ts';
import { dedupeByUrl, parseFeed, type FeedItem } from '../domain/rss.ts';
import { sanitize } from '../domain/sanitizer.ts';
import type { GeminiClient } from '../providers/gemini.ts';
import { renderCard, CARD_H, CARD_W } from '../media/card.ts';
import { createGenerated } from './contents.ts';
import { recentItems, scoreItems, type SourceItem } from './sources.ts';
import { getAppSettings } from './appSettings.ts';
import { capCheck, estimateCost, recordUsage } from './costs.ts';
import { isPaused } from './settings.ts';

/** Đọc RSS theo danh sách nguồn; một nguồn lỗi không làm hỏng cả lượt (FR-RES-03). */
export async function fetchFeeds(feeds: string[]): Promise<FeedItem[]> {
  const all: FeedItem[] = [];
  for (const u of feeds) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 peapod-curate' }, signal: AbortSignal.timeout(20_000) });
      all.push(...parseFeed(await r.text(), 15));
    } catch (e) {
      console.warn(`cảnh báo: nguồn lỗi ${u} (${(e as Error).name})`);
    }
  }
  return dedupeByUrl(all);
}

export interface GenerateDeps {
  db: pg.Pool;
  gemini: GeminiClient;
  schema: object;
  /** Thư mục lưu ảnh thẻ (MEDIA_DIR). */
  mediaDir: string;
  /** Đọc RSS: mặc định dùng nguồn trong cấu hình. Có thể thay trong test. */
  fetchItems?: (m: Market, feeds: string[]) => Promise<FeedItem[]>;
  now?: () => Date;
}

export interface GenerateOptions {
  market: Market;
  limit: number;
  model: string;
  dryRun?: boolean;
}

export interface GenerateResult {
  title: string;
  outcome: 'created' | 'dry-run' | 'skipped' | 'error';
  detail: string;
  id?: number;
  pkg?: ContentPackage;
}

const PAUSED_DETAIL = 'Công tắc tạm dừng đang bật';

/** Ảnh thẻ cho một bài: PNG lưu vào MEDIA_DIR/cards và ghi vào media_asset (revision 1). */
export async function storeCard(db: pg.Pool, mediaDir: string, contentId: number, revision: number, pkg: ContentPackage, now = new Date()): Promise<string> {
  const png = await renderCard({
    market: pkg.market,
    title: pkg.post.headline,
    bullets: (pkg.media.card as { bullets?: string[] } | undefined)?.bullets ?? [],
    source: pkg.sources[0]!.title,
    date: new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(now),
  });
  const dir = path.join(mediaDir, 'cards');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${contentId}-r${revision}.png`);
  await writeFile(file, png);
  const sha = createHash('sha256').update(png).digest('hex');
  await db.query(
    "INSERT INTO media_asset(content_id, revision, kind, path, sha256, width, height) VALUES ($1,$2,'IMAGE',$3,$4,$5,$6)",
    [contentId, revision, file, sha, CARD_W, CARD_H],
  );
  return file;
}

/** Một mục nguồn -> một bài. Dùng chung cho bản tin RSS và bài chiến dịch. */
async function generateFromItem(
  deps: GenerateDeps,
  s: AppSettings,
  market: Market,
  item: { title: string; url: string; summary: string },
  model: string,
  purpose: 'NEWS' | 'CAMPAIGN',
): Promise<GenerateResult> {
  const title = item.title.slice(0, 60);
  const cap = await capCheck(deps.db, s, deps.now?.());
  if (!cap.allowed) return { title, outcome: 'skipped', detail: cap.reason! };

  const sanitized = sanitize(`${item.title} — ${item.summary}`);
  try {
    const gen = await deps.gemini.generateJson({
      model,
      system: `${NEWS_RULES}\n\n${NEWS_VOICE[market]}`,
      user: newsUserPrompt(market, `1. ${sanitized.text}\n   URL: ${item.url}`),
      schema: deps.schema,
    });
    const costUsd = estimateCost({ inputTokens: gen.usage.inputTokens, outputTokens: gen.usage.outputTokens, thoughtTokens: gen.usage.thoughtTokens }, s);
    await recordUsage(deps.db, { market, purpose, model, usage: gen.usage, costUsd });

    const v = validatePackage(gen.json);
    if (!v.ok) return { title, outcome: 'skipped', detail: `schema: ${v.errors[0]}` };
    const pkg = v.value;
    if (pkg.market !== market) return { title, outcome: 'skipped', detail: 'sai thị trường' };
    if (unknownSources(pkg, [item.url]).length) return { title, outcome: 'skipped', detail: 'nguồn không nằm trong nguồn đã cung cấp' };
    if (!languageMatchesMarket(pkg.post.body, market)) return { title, outcome: 'skipped', detail: 'sai ngôn ngữ' };

    const id = await createGenerated(deps.db, pkg, model);
    if (pkg.media.engine === 'REMOTION_CARD') {
      try {
        await storeCard(deps.db, deps.mediaDir, id, 1, pkg, deps.now?.());
      } catch (e) {
        console.warn(`cảnh báo: chưa dựng được ảnh thẻ bài #${id}: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    return { title: pkg.post.headline, outcome: 'created', detail: `bài #${id}`, id, pkg };
  } catch (e) {
    return { title, outcome: 'error', detail: (e as Error).message.slice(0, 160) };
  }
}

/** Sinh tối đa `limit` bản tin từ các mục RSS chưa dùng. */
export async function generateNews(deps: GenerateDeps, opts: GenerateOptions): Promise<GenerateResult[]> {
  if (await isPaused(deps.db)) return [{ title: '', outcome: 'skipped', detail: PAUSED_DETAIL }];
  const s = await getAppSettings(deps.db);
  const fetchItems = deps.fetchItems ?? ((_m: Market, feeds: string[]) => fetchFeeds(feeds));

  const used = new Set((await deps.db.query<{ url: string }>(`SELECT DISTINCT jsonb_array_elements(package->'sources')->>'url' AS url FROM content_revision`)).rows.map((r) => r.url));
  const candidates = unusedItems(await fetchItems(opts.market, s.feeds[opts.market]), used);
  const out: GenerateResult[] = [];
  let made = 0;
  for (const item of candidates) {
    if (made >= opts.limit) break;
    if (opts.dryRun) {
      out.push({ title: item.title.slice(0, 60), outcome: 'dry-run', detail: 'chưa gọi AI' });
      made++;
      continue;
    }
    const r = await generateFromItem(deps, s, opts.market, item, opts.model, 'NEWS');
    if (r.outcome === 'created') made++;
    out.push(r);
    if (r.outcome === 'skipped' && r.detail.startsWith('Đã đạt trần')) break;
  }
  return out;
}

export interface CampaignInput {
  market: Market;
  topic: string;
  sourceUrl: string;
  /** Nội dung nguồn do người dùng dán vào (hệ thống không tự tải trang). */
  sourceText: string;
  note?: string;
  model: string;
}

/** Bài chiến dịch: người duyệt nêu chủ đề, nguồn (https, thuộc miền được phép) và dán nội dung nguồn. */
export async function generateCampaign(deps: GenerateDeps, input: CampaignInput): Promise<GenerateResult> {
  if (await isPaused(deps.db)) return { title: input.topic, outcome: 'skipped', detail: PAUSED_DETAIL };
  const s = await getAppSettings(deps.db);
  if (!campaignSourceAllowed(input.sourceUrl, s.campaignDomains)) {
    return { title: input.topic, outcome: 'skipped', detail: `Nguồn phải là https và thuộc miền được phép: ${s.campaignDomains.join(', ')}` };
  }
  if (input.sourceText.trim().length < 80) return { title: input.topic, outcome: 'skipped', detail: 'Nội dung nguồn quá ngắn (cần ít nhất 80 ký tự)' };
  const summary = [input.sourceText.trim(), input.note?.trim() ? `Ghi chú chủ đề: ${input.note.trim()}` : ''].filter(Boolean).join('\n');
  return generateFromItem(deps, s, input.market, { title: input.topic, url: input.sourceUrl, summary }, input.model, 'CAMPAIGN');
}

// --- Tạo bài theo chủ đề: AI viết từ nhiều tin RSS liên quan (người duyệt chọn chủ đề) ---

/** Một lần gọi AI với nhiều tin làm căn cứ. Kiểm tra cùng quy tắc như bản tin đơn. */
async function generateFromBrief(
  deps: GenerateDeps,
  s: AppSettings,
  market: Market,
  items: { title: string; url: string; summary: string }[],
  system: string,
  user: string,
  model: string,
  purpose: 'NEWS' | 'CAMPAIGN',
  title: string,
): Promise<GenerateResult> {
  const cap = await capCheck(deps.db, s, deps.now?.());
  if (!cap.allowed) return { title, outcome: 'skipped', detail: cap.reason! };
  try {
    const gen = await deps.gemini.generateJson({ model, system, user, schema: deps.schema });
    const costUsd = estimateCost({ inputTokens: gen.usage.inputTokens, outputTokens: gen.usage.outputTokens, thoughtTokens: gen.usage.thoughtTokens }, s);
    await recordUsage(deps.db, { market, purpose, model, usage: gen.usage, costUsd });

    const v = validatePackage(gen.json);
    if (!v.ok) return { title, outcome: 'skipped', detail: `schema: ${v.errors[0]}` };
    const pkg = v.value;
    if (pkg.market !== market) return { title, outcome: 'skipped', detail: 'sai thị trường' };
    if (unknownSources(pkg, items.map((i) => i.url)).length) return { title, outcome: 'skipped', detail: 'nguồn không nằm trong tin đã thu thập' };
    if (!languageMatchesMarket(pkg.post.body, market)) return { title, outcome: 'skipped', detail: 'sai ngôn ngữ' };

    const id = await createGenerated(deps.db, pkg, model);
    if (pkg.media.engine === 'REMOTION_CARD') {
      try {
        await storeCard(deps.db, deps.mediaDir, id, 1, pkg, deps.now?.());
      } catch (e) {
        console.warn(`cảnh báo: chưa dựng được ảnh thẻ bài #${id}: ${(e as Error).message.slice(0, 120)}`);
      }
    }
    return { title: pkg.post.headline, outcome: 'created', detail: `bài #${id}`, id, pkg };
  } catch (e) {
    return { title, outcome: 'error', detail: (e as Error).message.slice(0, 160) };
  }
}

export interface TopicRequest {
  market: Market;
  topic: string;
  /** Các URL tin người duyệt đã chọn (từ đề xuất). Trống thì hệ thống tự tìm tin theo từ khóa chủ đề. */
  urls?: string[];
  model: string;
  /** Số tin tối đa làm căn cứ. */
  maxSources?: number;
}

/** Tạo bài theo chủ đề: lấy tin liên quan từ kho RSS (14 ngày), rồi AI viết bài có nhiều nguồn. */
export async function generateTopic(deps: GenerateDeps, req: TopicRequest): Promise<GenerateResult> {
  const title = req.topic.trim().slice(0, 60);
  if (await isPaused(deps.db)) return { title, outcome: 'skipped', detail: PAUSED_DETAIL };
  const s = await getAppSettings(deps.db);
  const now = deps.now?.() ?? new Date();
  const pool = await recentItems(deps.db, req.market, now, 14, 300);
  let chosen: SourceItem[];
  if (req.urls && req.urls.length > 0) {
    const want = new Set(req.urls);
    chosen = pool.filter((i) => want.has(i.url));
  } else {
    chosen = scoreItems(pool, req.topic, req.maxSources ?? 3);
  }
  if (chosen.length === 0) {
    return { title, outcome: 'skipped', detail: 'Không có tin liên quan trong 14 ngày gần đây. Chọn chủ đề khác hoặc chờ nguồn cập nhật.' };
  }
  const items = chosen.slice(0, req.maxSources ?? 3).map((i) => ({ title: i.title, url: i.url, summary: i.summary }));
  const brief = items
    .map((it, n) => {
      const clean = sanitize(`${it.title} — ${it.summary}`);
      return `${n + 1}. ${clean.text}\n   URL: ${it.url}`;
    })
    .join('\n');
  return generateFromBrief(deps, s, req.market, items, `${TOPIC_RULES}\n\n${NEWS_VOICE[req.market]}`, topicUserPrompt(req.market, req.topic.trim(), brief), req.model, 'NEWS', title);
}
