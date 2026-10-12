import { describe, expect, it } from 'vitest';

import { evaluateFlag, rolloutBucket, type FlagDefinition, type FlagOverride } from './evaluate';

const now = new Date('2026-10-12T12:00:00Z');
const flag: FlagDefinition = {
  key: 'voice.azure_realtime',
  defaultValue: false,
  rolloutPercent: 0,
  isArchived: false,
};
const ids = { organizationId: 'org-1', locationId: 'loc-1', userId: 'user-1', planId: 'plan-1' };
const o = (
  scopeType: FlagOverride['scopeType'],
  scopeId: string,
  value: unknown,
  expiresAt: string | null = null,
): FlagOverride => ({
  scopeType,
  scopeId,
  value,
  expiresAt,
});

describe('FR-ADM-005 feature flag evaluation', () => {
  it('falls back to the default', () => {
    expect(evaluateFlag(flag, [], ids, now)).toBe(false);
  });

  it('applies overrides by precedence: user > location > organization > plan', () => {
    const all = [
      o('plan', 'plan-1', 'plan'),
      o('organization', 'org-1', 'org'),
      o('location', 'loc-1', 'loc'),
      o('user', 'user-1', 'user'),
    ];
    expect(evaluateFlag(flag, all, ids, now)).toBe('user');
    expect(evaluateFlag(flag, all.slice(0, 3), ids, now)).toBe('loc');
    expect(evaluateFlag(flag, all.slice(0, 2), ids, now)).toBe('org');
    expect(evaluateFlag(flag, all.slice(0, 1), ids, now)).toBe('plan');
  });

  it('ignores expired overrides and overrides for other scopes', () => {
    expect(
      evaluateFlag(flag, [o('organization', 'org-1', true, '2026-10-01T00:00:00Z')], ids, now),
    ).toBe(false);
    expect(evaluateFlag(flag, [o('organization', 'org-2', true)], ids, now)).toBe(false);
  });

  it('archived flags always return their default', () => {
    expect(evaluateFlag({ ...flag, isArchived: true }, [o('user', 'user-1', true)], ids, now)).toBe(
      false,
    );
  });

  it('rolls out deterministically by organization, close to the percentage', () => {
    const half = { ...flag, rolloutPercent: 50 };
    const orgs = Array.from({ length: 2000 }, (_, i) => `org-${i}`);
    const on = orgs.filter(
      (org) => evaluateFlag(half, [], { organizationId: org }, now) === true,
    ).length;
    expect(on / orgs.length).toBeGreaterThan(0.45);
    expect(on / orgs.length).toBeLessThan(0.55);
    expect(evaluateFlag(half, [], { organizationId: 'org-7' }, now)).toBe(
      evaluateFlag(half, [], { organizationId: 'org-7' }, now),
    );
    expect(rolloutBucket('a.b', 'x')).toBeGreaterThanOrEqual(0);
    // Without an organization there is nothing to bucket by.
    expect(evaluateFlag({ ...flag, rolloutPercent: 100 }, [], {}, now)).toBe(false);
  });
});
