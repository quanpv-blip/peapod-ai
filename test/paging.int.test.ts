import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { pageInfo } from '../src/domain/paging.ts';
import type { ContentPackage } from '../src/domain/package.ts';
import type { Actor } from '../src/auth.ts';
import { countAudit, countContents, createGenerated, listAudit, listContents } from '../src/services/contents.ts';
import { freshDb } from './helpers/freshDb.ts';

const URL_ = process.env.TEST_DATABASE_URL;
const d = URL_ ? describe : describe.skip;
const admin: Actor = { email: 'ad@t', name: 'Admin', roles: ['admin'] };
const MIGRATIONS = ['001_init.sql', '002_users.sql', '003_publish_audit.sql', '004_settings.sql', '005_rename_app_config.sql', '006_ai_usage.sql'];

const pkg = (n: number): ContentPackage => ({
  market: 'VN',
  topic_summary: 't',
  post: { headline: `Tin số ${n} về công nghệ`, body: 'Nội dung tiếng Việt trung lập về sự kiện công nghệ hôm nay.', call_to_action: 'Bạn nghĩ sao?', hashtags: ['#CN'] },
  sources: [{ title: 'VnExpress', url: `https://vnexpress.net/p${n}` }],
  claims_to_verify: [],
  media: { engine: 'NONE' },
});

d('phân trang danh sách (PostgreSQL thật)', () => {
  let db: pg.Pool;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    const f = await freshDb(URL_!, MIGRATIONS);
    db = f.db;
    drop = f.drop;
    for (let n = 1; n <= 7; n++) await createGenerated(db, pkg(n), 'test');
    await db.query("INSERT INTO approval_event(content_id, revision, package_hash, actor, action) SELECT id, 1, 'h', 'ad@t', 'APPROVE' FROM content_item");
  });
  afterAll(async () => {
    await drop?.();
  });

  it('đếm tổng đúng và chia trang không trùng, không sót', async () => {
    const total = await countContents(db, admin);
    expect(total).toBe(7);
    const seen = new Set<number>();
    for (let n = 1; n <= 3; n++) {
      const p = pageInfo(String(n), total, 3);
      const rows = await listContents(db, admin, { limit: p.size, offset: p.offset });
      for (const r of rows) seen.add(Number(r.id));
    }
    expect(seen.size).toBe(7);
  });

  it('bộ lọc được áp dụng cho cả đếm và danh sách', async () => {
    const filter = { q: 'Tin số 3' };
    expect(await countContents(db, admin, filter)).toBe(1);
    expect(await listContents(db, admin, { ...filter, limit: 10, offset: 0 })).toHaveLength(1);
  });

  it('nhật ký: đếm và phân trang theo số dòng, mỗi dòng có một lần tạo', async () => {
    const total = await countAudit(db, admin);
    expect(total).toBe(7);
    expect(await listAudit(db, admin, 3, 0)).toHaveLength(3);
    expect(await listAudit(db, admin, 3, 6)).toHaveLength(1);
    expect(await listAudit(db, admin, 3, 9)).toHaveLength(0);
  });
});
