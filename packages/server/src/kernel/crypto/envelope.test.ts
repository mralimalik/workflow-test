import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { EnvelopeCipher } from './envelope';
import { Pepper, safeEqual } from './secrets';

const k1 = { id: 'k1', key: randomBytes(32) };
const k2 = { id: 'k2', key: randomBytes(32) };

describe('EnvelopeCipher (BACKEND.md §12)', () => {
  it('round-trips and uses a fresh data key and IV per record', () => {
    const cipher = new EnvelopeCipher(k1);
    const a = cipher.encrypt('JBSWY3DPEHPK3PXP', 'mfa_factors:1');
    const b = cipher.encrypt('JBSWY3DPEHPK3PXP', 'mfa_factors:1');
    expect(a.equals(b)).toBe(false);
    expect(cipher.decrypt(a, 'mfa_factors:1').toString()).toBe('JBSWY3DPEHPK3PXP');
    expect(EnvelopeCipher.keyIdOf(a)).toBe('k1');
  });

  it('rejects a ciphertext moved to another record, or tampered with', () => {
    const cipher = new EnvelopeCipher(k1);
    const env = cipher.encrypt('secret', 'mfa_factors:1');
    expect(() => cipher.decrypt(env, 'mfa_factors:2')).toThrow();
    const tampered = Buffer.from(env);
    tampered[tampered.length - 1] = (tampered.at(-1) ?? 0) ^ 1;
    expect(() => cipher.decrypt(tampered, 'mfa_factors:1')).toThrow();
  });

  it('reads records wrapped with a previous master key after rotation', () => {
    const old = new EnvelopeCipher(k1).encrypt('secret', 'r');
    const rotated = new EnvelopeCipher(k2, [k1]);
    expect(rotated.decrypt(old, 'r').toString()).toBe('secret');
    expect(() => new EnvelopeCipher(k2).decrypt(old, 'r')).toThrow(/Unknown master key/);
  });
});

describe('Pepper and safeEqual', () => {
  it('derives distinct keys per purpose', () => {
    const secret = 'x'.repeat(32);
    expect(new Pepper(secret, 'a').hash('123456')).not.toEqual(
      new Pepper(secret, 'b').hash('123456'),
    );
    expect(new Pepper(secret, 'a').hash('123456')).toEqual(new Pepper(secret, 'a').hash('123456'));
  });

  it('compares values of different lengths safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
