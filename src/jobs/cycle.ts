// Một chu kỳ nền (worker gọi mỗi vài phút): đăng bài đã duyệt, đối soát, và sinh bản tin theo giờ cấu hình.
// Chu kỳ không làm gì khi công tắc tạm dừng đang bật. Mỗi việc có nhãn riêng trong nhật ký để dễ tra.
import type pg from 'pg';
import type { Market } from '../domain/package.ts';
import type { GeminiClient } from '../providers/gemini.ts';
import { getFlag, setFlag, getAppSettings } from '../services/appSettings.ts';
import { generateNews } from '../services/generate.ts';
import { autoApproveVN } from '../services/autoApprove.ts';
import { isPaused } from '../services/settings.ts';
import { publishApproved, reconcileScheduled, type PublisherDeps } from '../services/publish.ts';

export interface CycleDeps {
  db: pg.Pool;
  publisher?: PublisherDeps;
  generator?: { gemini: GeminiClient; schema: object; mediaDir: string; model: string };
  notify: (text: string) => Promise<unknown>;
  now?: () => Date;
}

const TZ: Record<Market, string> = { VN: 'Asia/Ho_Chi_Minh', JP: 'Asia/Tokyo' };

/** Giờ và ngày hiện tại theo múi giờ thị trường (HH:MM, YYYY-MM-DD). */
export function localClock(market: Market, now: Date): { hhmm: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ[market], year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return { hhmm: `${get('hour')}:${get('minute')}`, day: `${get('year')}-${get('month')}-${get('day')}` };
}

/** Chạy một chu kỳ; trả về các dòng nhật ký để worker ghi ra. */
export async function runCycle(deps: CycleDeps): Promise<string[]> {
  const now = deps.now?.() ?? new Date();
  const log: string[] = [];
  if (await isPaused(deps.db)) return ['công tắc tạm dừng đang bật: bỏ qua chu kỳ'];

  if (deps.publisher) {
    const pub = await publishApproved(deps.publisher);
    const rec = await reconcileScheduled(deps.publisher);
    const failed = pub.filter((r) => r.outcome === 'failed');
    const scheduled = pub.filter((r) => r.outcome === 'scheduled').length;
    const published = rec.filter((r) => r.outcome === 'published').length;
    const lost = rec.filter((r) => r.outcome === 'failed');
    log.push(`đăng: ${scheduled} hẹn mới, ${failed.length} lỗi; đối soát: ${published} đã đăng, ${lost.length} cần kiểm tra`);
    for (const r of [...failed, ...lost]) await deps.notify(`⚠️ Bài #${r.id}: ${r.detail}`);
    if (scheduled) await deps.notify(`🗓️ Đã hẹn ${scheduled} bài lên Trang`);
  }

  if (deps.generator) {
    const s = await getAppSettings(deps.db);
    for (const market of ['VN', 'JP'] as Market[]) {
      const clock = localClock(market, now);
      if (clock.hhmm < s.genTime[market]) continue;
      const key = `gen_last_${market}`;
      if ((await getFlag(deps.db, key)) === clock.day) continue;
      const results = await generateNews(
        { db: deps.db, gemini: deps.generator.gemini, schema: deps.generator.schema, mediaDir: deps.generator.mediaDir, now: () => now },
        { market, limit: 2, model: deps.generator.model },
      );
      await setFlag(deps.db, key, clock.day, 'system:cycle');
      const made = results.filter((r) => r.outcome === 'created').length;
      const errors = results.filter((r) => r.outcome === 'error').length;
      log.push(`sinh ${market}: ${made} bài mới${errors ? `, ${errors} lỗi` : ''}`);
      if (made) await deps.notify(`🆕 ${made} bản tin ${market} đang chờ duyệt trong hàng chờ`);
    }
  }

  // Tự duyệt VN theo điều kiện (tắt mặc định). Bài vừa duyệt sẽ được hẹn lên Trang ở chu kỳ kế tiếp.
  const auto = await autoApproveVN(deps.db, now);
  if (auto.length) {
    const approved = auto.filter((r) => r.outcome === 'approved');
    const waiting = auto.filter((r) => r.outcome === 'skipped').length;
    const failed = auto.filter((r) => r.outcome === 'failed').length;
    log.push(`tự duyệt VN: ${approved.length} duyệt, ${waiting} chờ người, ${failed} lỗi`);
    for (const r of approved) await deps.notify(`✅ Tự duyệt bài #${r.id} (VN): ${r.headline ?? ''}`);
  }
  return log.length ? log : ['không có việc cần làm'];
}
