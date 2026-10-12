import { createHash } from 'node:crypto';

export interface FlagDefinition {
  key: string;
  defaultValue: unknown;
  rolloutPercent: number;
  isArchived: boolean;
}

export interface FlagOverride {
  scopeType: 'plan' | 'organization' | 'location' | 'user';
  scopeId: string;
  value: unknown;
  expiresAt: string | null;
}

export interface FlagContext {
  organizationId?: string | null;
  locationId?: string | null;
  userId?: string | null;
  planId?: string | null;
}

/** Most specific first. */
const PRECEDENCE: readonly FlagOverride['scopeType'][] = [
  'user',
  'location',
  'organization',
  'plan',
];

/** Deterministic 0–99 bucket per (flag, organization), so a rollout is stable and spreads evenly. */
export function rolloutBucket(flagKey: string, unitId: string): number {
  return createHash('sha256').update(`${flagKey}:${unitId}`).digest().readUInt32BE(0) % 100;
}

/**
 * Pure flag evaluation (FR-ADM-005): unexpired override by precedence
 * (user > location > organization > plan), then percentage rollout by organization for
 * boolean flags, then the default. Archived flags evaluate to their default.
 */
export function evaluateFlag(
  flag: FlagDefinition,
  overrides: readonly FlagOverride[],
  ctx: FlagContext,
  now: Date,
): unknown {
  if (flag.isArchived) return flag.defaultValue;
  const live = overrides.filter((o) => o.expiresAt === null || new Date(o.expiresAt) > now);
  const ids: Record<FlagOverride['scopeType'], string | null | undefined> = {
    user: ctx.userId,
    location: ctx.locationId,
    organization: ctx.organizationId,
    plan: ctx.planId,
  };
  for (const scope of PRECEDENCE) {
    const id = ids[scope];
    if (!id) continue;
    const match = live.find((o) => o.scopeType === scope && o.scopeId === id);
    if (match) return match.value;
  }
  if (typeof flag.defaultValue === 'boolean' && flag.rolloutPercent > 0 && ctx.organizationId) {
    if (rolloutBucket(flag.key, ctx.organizationId) < flag.rolloutPercent) return true;
  }
  return flag.defaultValue;
}
