import { describe, expect, it } from 'vitest';

import { deviceLabel } from './device-label';
import { passwordProblems } from './password-policy';
import {
  initialExpiry,
  needsTouch,
  REALM_POLICY,
  sessionState,
  slidIdleExpiry,
} from './realm-policy';
import { generateRecoveryCodes, normalizeRecoveryCode } from './recovery-codes';

const t0 = new Date('2026-10-12T10:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);
const HOUR = 3_600_000;

describe('session lifetimes per realm (FR-AUTH, rule 7)', () => {
  it('users: idle 12 h, absolute 30 d', () => {
    const times = initialExpiry('user', t0);
    expect(times.idleExpiresAt).toEqual(at(12 * HOUR));
    expect(times.absoluteExpiresAt).toEqual(at(30 * 24 * HOUR));
    expect(sessionState(times, at(11 * HOUR))).toBe('active');
    expect(sessionState(times, at(12 * HOUR))).toBe('idle_expired');
  });

  it('activity slides the idle expiry, never past the absolute cap', () => {
    const { absoluteExpiresAt } = initialExpiry('platform_admin', t0);
    expect(slidIdleExpiry('platform_admin', at(HOUR), absoluteExpiresAt)).toEqual(at(1.5 * HOUR));
    expect(slidIdleExpiry('platform_admin', at(11.9 * HOUR), absoluteExpiresAt)).toEqual(
      absoluteExpiresAt,
    );
    expect(sessionState({ idleExpiresAt: at(13 * HOUR), absoluteExpiresAt }, at(12 * HOUR))).toBe(
      'absolute_expired',
    );
  });

  it('touches at most once a minute and uses one cookie per realm', () => {
    expect(needsTouch(t0, at(59_000))).toBe(false);
    expect(needsTouch(t0, at(60_000))).toBe(true);
    expect(new Set(Object.values(REALM_POLICY).map((p) => p.cookie)).size).toBe(3);
  });
});

describe('password policy (rule 2)', () => {
  it('requires 10+ characters and rejects passwords built from the email', () => {
    expect(passwordProblems('short', 'ana@example.com')).toEqual(['too_short']);
    expect(passwordProblems('correct horse battery', 'ana@example.com')).toEqual([]);
    expect(passwordProblems('ana.lopez-2026!', 'ana.lopez@example.com')).toEqual([
      'contains_email',
    ]);
    // Length counts characters, not UTF-16 units.
    expect(passwordProblems('🔑🔑🔑🔑🔑🔑🔑🔑🔑', 'a@b.co')).toEqual(['too_short']);
  });
});

describe('recovery codes', () => {
  it('generates 10 distinct, unambiguous codes and normalizes typed input', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normalizeRecoveryCode(' abcdo-1ilxy ')).toBe('ABCD0111XY');
  });
});

describe('device labels', () => {
  it('summarizes browser and OS', () => {
    expect(
      deviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS');
    expect(deviceLabel(undefined)).toBeNull();
  });
});
