// FR-RES-03: đọc RSS 2.0, Atom và RDF/RSS 1.0 (Nikkei XTECH dùng RDF). Không phụ thuộc thư viện XML ngoài.

export interface FeedItem {
  title: string;
  url: string;
  publishedAt?: string;
  summary: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function stripTags(s: string): string {
  return decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tag(block: string, names: string[]): string | undefined {
  for (const n of names) {
    const m = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, 'i').exec(block);
    if (m?.[1] !== undefined) return m[1];
  }
  return undefined;
}

function linkOf(block: string): string | undefined {
  const plain = tag(block, ['link']);
  if (plain && /^\s*(?:<!\[CDATA\[)?\s*https?:/i.test(plain)) return stripTags(plain);
  // Atom: <link rel="alternate" href="..."/>
  const m = /<link\b[^>]*?href="([^"]+)"[^>]*>/i.exec(block);
  return m?.[1] ? decode(m[1]) : undefined;
}

export function parseFeed(xml: string, limit = 50): FeedItem[] {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  const items: FeedItem[] = [];
  for (const b of blocks) {
    const title = stripTags(tag(b, ['title']) ?? '');
    const url = linkOf(b);
    if (!title || !url) continue;
    const summary = stripTags(tag(b, ['description', 'summary', 'content:encoded', 'content']) ?? '').slice(0, 400);
    const published = tag(b, ['pubDate', 'dc:date', 'published', 'updated']);
    items.push({ title, url, summary, publishedAt: published ? stripTags(published) : undefined });
    if (items.length >= limit) break;
  }
  return items;
}

/** Bỏ trùng URL, giữ thứ tự. */
export function dedupeByUrl(items: FeedItem[]): FeedItem[] {
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.url) ? false : (seen.add(i.url), true)));
}
