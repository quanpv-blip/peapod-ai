import { describe, expect, it } from 'vitest';
import { sanitize } from '../src/domain/sanitizer.ts';

describe('sanitizer (FR-RES-05)', () => {
  it('che email, điện thoại, IP, khóa API, mã nguồn', () => {
    const input =
      'Liên hệ a.b@peasoft.vn hoặc 0912 345 678 / +81 90-1234-5678, máy 10.0.0.12, key xai-ABCDEFGHIJKLMNOPQRSTUV ```select * from users```';
    const { text, redactions } = sanitize(input);
    expect(text).not.toMatch(/peasoft|0912|1234-5678|10\.0\.0\.12|xai-ABC|select \*/);
    expect(Object.keys(redactions).sort()).toEqual(['api_key', 'code_block', 'email', 'ip', 'phone']);
  });
  it('che tên khách hàng và tên miền nội bộ', () => {
    const { text, redactions } = sanitize('Dự án của ACME Corp chạy trên git.peasoft.vn', {
      denyTerms: ['acme corp'],
      internalDomains: ['peasoft.vn'],
    });
    expect(text).not.toMatch(/acme|peasoft/i);
    expect(redactions.deny_term).toBe(1);
    expect(redactions.internal_domain).toBe(1);
  });
  it('không ghi nội dung gốc vào thống kê', () => {
    const { redactions } = sanitize('bí mật: a@b.com');
    expect(JSON.stringify(redactions)).not.toContain('a@b.com');
  });
  it('giữ nguyên văn bản sạch', () => {
    const s = 'Xu hướng microservices năm 2026';
    expect(sanitize(s).text).toBe(s);
  });
});
