import pg from 'pg';
import { describe, expect, it } from 'vitest';
import '../src/db.ts';

describe('kiểu BIGINT', () => {
  it('int8 trả về number, không phải chuỗi (R-06)', () => {
    const parse = pg.types.getTypeParser(20) as (v: string) => unknown;
    expect(parse('42')).toBe(42);
    expect(typeof parse('9007')).toBe('number');
  });
});
