// Tự duyệt bài VN theo điều kiện (xem domain/autoApprove.ts). Ghi nhật ký dưới tài khoản hệ thống để luôn phân biệt được với người duyệt.
import type pg from 'pg';
import type { Actor } from '../auth.ts';
import { autoApproveCheck, type AutoContext } from '../domain/autoApprove.ts';
import type { ContentPackage } from '../domain/package.ts';
import { nextBusinessSlot } from '../domain/schedule.ts';
import * as svc from './contents.ts';
import { getAppSettings } from './appSettings.ts';
import { ictStart } from './costs.ts';
import { isPaused } from './settings.ts';

export const AUTO_ACTOR_EMAIL = 'system:auto-approve';
const auto: Actor = { email: AUTO_ACTOR_EMAIL, name: 'Tự động duyệt', roles: ['approver_vn'] };

export interface AutoResult {
  id: number;
  outcome: 'approved' | 'skipped' | 'failed';
  detail: string;
  headline?: string;
}

export async function autoApproveVN(db: pg.Pool, now = new Date()): Promise<AutoResult[]> {
  const s = await getAppSettings(db);
  if (!s.autoApproveVN || (await isPaused(db))) return [];

  const { day } = ictStart(now);
  const usedToday = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM approval_event WHERE actor = $1 AND action = 'APPROVE' AND created_at >= $2", [AUTO_ACTOR_EMAIL, day])).rows[0]!.n;
  let budget = s.autoApproveDailyMax - usedToday;
  if (budget <= 0) return [];

  const feedDomains = s.feeds.VN.map((u) => new URL(u).hostname.toLowerCase());
  const candidates = await db.query<{ id: number; current_revision: number; package: ContentPackage; package_hash: string; edited_by: string | null; has_image: boolean }>(
    `SELECT i.id, i.current_revision, r.package, r.package_hash, r.edited_by,
            EXISTS (SELECT 1 FROM media_asset m WHERE m.content_id = i.id AND m.revision = i.current_revision AND m.kind = 'IMAGE') AS has_image
       FROM content_item i JOIN content_revision r ON r.content_id = i.id AND r.revision = i.current_revision
      WHERE i.market = 'VN' AND i.state = 'IN_REVIEW'
      ORDER BY i.id LIMIT 50`,
  );

  const out: AutoResult[] = [];
  for (const row of candidates.rows) {
    const id = Number(row.id);
    const headline = row.package.post.headline;
    if (budget <= 0) break;
    const ctx: AutoContext = { hasImage: row.has_image, editedByHuman: row.edited_by !== null, feedDomains };
    const check = autoApproveCheck(row.package, ctx);
    if (!check.ok) {
      out.push({ id, outcome: 'skipped', detail: check.reason, headline });
      continue;
    }
    try {
      await svc.approve(
        db,
        auto,
        id,
        { revision: row.current_revision, packageHash: row.package_hash, scheduledAt: nextBusinessSlot('VN', s.defaultPostTime.VN, now), claimsConfirmed: true },
        { fourEyesMarkets: [] },
        now,
      );
      budget--;
      out.push({ id, outcome: 'approved', detail: 'tự duyệt theo điều kiện', headline });
    } catch (e) {
      out.push({ id, outcome: 'failed', detail: (e as Error).message.slice(0, 160), headline });
    }
  }
  return out;
}
