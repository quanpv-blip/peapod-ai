import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATES, TERMINAL, assertTransition, canTransition, InvalidTransitionError } from '../src/domain/states.ts';

describe('máy trạng thái', () => {
  it('khớp CHECK(state) trong migration', () => {
    const sql = readFileSync('db/migrations/001_init.sql', 'utf8');
    const block = /state\s+TEXT NOT NULL CHECK \(state IN \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? '';
    const inSql = [...block.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
    expect(inSql).toEqual([...STATES].sort());
  });
  it('luồng chính hợp lệ', () => {
    const path = ['GENERATING', 'MEDIA_PENDING', 'IN_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED'] as const;
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
  });
  it('không thể đăng khi chưa duyệt', () => {
    expect(canTransition('IN_REVIEW', 'PUBLISHING')).toBe(false);
    expect(canTransition('IN_REVIEW', 'PUBLISHED')).toBe(false);
    expect(canTransition('GENERATING', 'SCHEDULED')).toBe(false);
  });
  it('sửa sau duyệt/lên lịch quay về IN_REVIEW', () => {
    expect(canTransition('APPROVED', 'IN_REVIEW')).toBe(true);
    expect(canTransition('SCHEDULED', 'IN_REVIEW')).toBe(true);
  });
  it('trạng thái kết thúc không đi tiếp', () => {
    expect([...TERMINAL].sort()).toEqual(['CANCELLED', 'PUBLISHED', 'REJECTED']);
    for (const t of TERMINAL) for (const s of STATES) expect(canTransition(t, s)).toBe(false);
  });
  it('ném lỗi có kiểu', () => {
    expect(() => assertTransition('PUBLISHED', 'GENERATING')).toThrow(InvalidTransitionError);
  });
});
