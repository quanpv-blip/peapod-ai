import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ajv } from 'ajv';
import { default as addFormats } from 'ajv-formats';

const here = path.dirname(fileURLToPath(import.meta.url));
const schemaFile = path.resolve(here, '..', '..', 'schemas', 'content_package.schema.json');

export type Market = 'VN' | 'JP';

export interface ContentPackage {
  market: Market;
  topic_summary: string;
  post: { headline: string; body: string; call_to_action: string; hashtags: string[] };
  sources: { title: string; url: string }[];
  claims_to_verify: string[];
  media: { engine: 'NONE' | 'REMOTION_CARD' | 'REMOTION_VIDEO' | 'GROK_IMAGINE_REEL'; [k: string]: unknown };
}

const wrapper = JSON.parse(readFileSync(schemaFile, 'utf8')) as { schema: object };
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats.default ? addFormats.default(ajv) : (addFormats as unknown as (a: Ajv) => void)(ajv);
const validateFn = ajv.compile(wrapper.schema);

export type ValidationResult = { ok: true; value: ContentPackage } | { ok: false; errors: string[] };

/** Kiểm tra lại phía ứng dụng (FR-GEN-03): không tin hoàn toàn vào ràng buộc phía nhà cung cấp. */
export function validatePackage(input: unknown): ValidationResult {
  if (!validateFn(input)) {
    const errors = (validateFn.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim());
    return { ok: false, errors };
  }
  return { ok: true, value: input as ContentPackage };
}

/** JSON chuẩn hóa (khóa sắp xếp) để băm ổn định, không phụ thuộc thứ tự khóa. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function packageHash(pkg: unknown): string {
  return createHash('sha256').update(canonicalJson(pkg)).digest('hex');
}

/** FR-GEN-04: mọi sources.url phải nằm trong brief; trả về các URL lạ (nghi bịa). */
export function unknownSources(pkg: ContentPackage, briefUrls: Iterable<string>): string[] {
  const allowed = new Set([...briefUrls].map(normalizeUrl));
  return pkg.sources.map((s) => s.url).filter((u) => !allowed.has(normalizeUrl(u)));
}

function normalizeUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

const JP_CHAR = /[぀-ヿ㐀-䶿一-鿿]/g;
const LETTER = /[\p{L}]/gu;

/** FR-GEN-05: kiểm tra thô ngôn ngữ đúng thị trường. Không thay thế việc người duyệt đọc. */
export function languageMatchesMarket(text: string, market: Market): boolean {
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters === 0) return false;
  const jp = text.match(JP_CHAR)?.length ?? 0;
  const ratio = jp / letters;
  return market === 'JP' ? ratio >= 0.3 : ratio <= 0.02;
}
