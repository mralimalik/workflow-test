import { describe, expect, it } from 'vitest';

import {
  CROCKFORD_ALPHABET,
  isUuidV7,
  newId,
  newReferenceCode,
  normalizeReferenceCode,
} from './ids';

describe('ids', () => {
  it('generates UUIDv7 ids that sort by creation time', () => {
    const ids = Array.from({ length: 100 }, () => newId());
    expect(ids.every(isUuidV7)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
  });

  it('generates reference codes with an unambiguous alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const code = newReferenceCode('BK');
      expect(code).toMatch(/^BK-[0-9A-Z]{6}$/);
      expect(Array.from(code.slice(3)).every((c) => CROCKFORD_ALPHABET.includes(c))).toBe(true);
      expect(code).not.toMatch(/[ILOU]/);
    }
  });

  it('rejects invalid prefixes', () => {
    expect(() => newReferenceCode('B')).toThrow();
    expect(() => newReferenceCode('bk')).toThrow();
  });

  it('normalizes typed or spoken reference codes', () => {
    expect(normalizeReferenceCode(' bk-7f3k2q ')).toBe('BK-7F3K2Q');
    expect(normalizeReferenceCode('BK 7F3K2Q')).toBe('BK-7F3K2Q');
    expect(normalizeReferenceCode('bkO1IL23')).toBe('BK-011123');
    expect(normalizeReferenceCode('BK-7F3K2')).toBeNull();
    expect(normalizeReferenceCode('BK-7F3K2U')).toBeNull();
  });
});
