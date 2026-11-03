import type { Market } from '../../domain/package.ts';
import { marketTag, status } from '../components.ts';
import { empty, html } from '../html.ts';
import { page, type PageCtx } from '../layout.ts';

export interface SlotRow {
  id: number;
  market: Market;
  state: string;
  scheduled_at: Date;
  headline: string;
}

const TZ: Record<Market, string> = { VN: 'Asia/Ho_Chi_Minh', JP: 'Asia/Tokyo' };
const dayOf = (d: Date, m: Market) => new Intl.DateTimeFormat('vi-VN', { timeZone: TZ[m], weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
const hhmm = (d: Date, m: Market) => new Intl.DateTimeFormat('vi-VN', { timeZone: TZ[m], hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

export function scheduleView(ctx: Omit<PageCtx, 'title' | 'nav'>, rows: SlotRow[]): string {
  // Gom theo (ngày theo giờ của thị trường). Hai bài cùng giờ trên cùng thị trường = cảnh báo xung đột (cùng một Page).
  const groups = new Map<string, SlotRow[]>();
  for (const r of rows) {
    const k = `${r.market}|${dayOf(r.scheduled_at, r.market)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const clash = (r: SlotRow) => rows.some((o) => o.id !== r.id && o.market === r.market && Math.abs(o.scheduled_at.getTime() - r.scheduled_at.getTime()) < 30 * 60_000);

  const body = groups.size
    ? [...groups.entries()].map(([k, items]) => {
        const [m, label] = k.split('|') as [Market, string];
        return html`<section class="day"><div class="day-h">${marketTag(m)}<h2>${label}</h2></div>
          ${items.map((r) => html`<div class="slot">
            <div class="t">${hhmm(r.scheduled_at, m)} <span class="muted small">${m === 'VN' ? 'ICT' : 'JST'}</span></div>
            <div class="h"><a href="/contents/${r.id}">${r.headline}</a> ${clash(r) ? html`<span class="warn-t">· Trùng giờ với bài khác (cách dưới 30 phút)</span>` : empty}</div>
            <div>${status(r.state)}</div>
          </div>`)}</section>`;
      })
    : html`<div class="table-wrap"><div class="empty">Chưa có bài nào được hẹn giờ. Duyệt một bài để nó xuất hiện ở đây.</div></div>`;

  return page(
    { ...ctx, title: 'Lịch đăng', nav: 'schedule' },
    html`<div class="page">
      <div class="page-head"><div><h1>Lịch đăng</h1><div class="sub">Các bài đã duyệt, sắp xếp theo giờ đăng (giờ địa phương của từng thị trường)</div></div><span class="muted">${rows.length} bài</span></div>
      ${body}
    </div>`,
  );
}

