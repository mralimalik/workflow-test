import type { Realm } from '@attendra/contracts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface RealmPolicy {
  /** Session cookie name (BACKEND.md §6.1). */
  readonly cookie: string;
  /** Sliding idle timeout and hard cap (features/auth-and-identity.md rule 7). */
  readonly idleMs: number;
  readonly absoluteMs: number;
}

export const REALM_POLICY: Readonly<Record<Realm, RealmPolicy>> = {
  user: { cookie: 'att_u', idleMs: 12 * HOUR, absoluteMs: 30 * DAY },
  customer: { cookie: 'att_c', idleMs: 30 * DAY, absoluteMs: 90 * DAY },
  platform_admin: { cookie: 'att_a', idleMs: 30 * MINUTE, absoluteMs: 12 * HOUR },
};

/** `last_seen_at` / idle expiry are written at most this often (data model 01). */
export const TOUCH_INTERVAL_MS = MINUTE;

export interface SessionTimes {
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export function initialExpiry(realm: Realm, now: Date): SessionTimes {
  const p = REALM_POLICY[realm];
  const absoluteExpiresAt = new Date(now.getTime() + p.absoluteMs);
  return {
    idleExpiresAt: new Date(Math.min(now.getTime() + p.idleMs, absoluteExpiresAt.getTime())),
    absoluteExpiresAt,
  };
}

/** Idle expiry after activity at `now`, never past the absolute cap. */
export function slidIdleExpiry(realm: Realm, now: Date, absoluteExpiresAt: Date): Date {
  return new Date(
    Math.min(now.getTime() + REALM_POLICY[realm].idleMs, absoluteExpiresAt.getTime()),
  );
}

export type SessionState = 'active' | 'idle_expired' | 'absolute_expired';

export function sessionState(times: SessionTimes, now: Date): SessionState {
  if (now >= times.absoluteExpiresAt) return 'absolute_expired';
  if (now >= times.idleExpiresAt) return 'idle_expired';
  return 'active';
}

export function needsTouch(lastSeenAt: Date, now: Date): boolean {
  return now.getTime() - lastSeenAt.getTime() >= TOUCH_INTERVAL_MS;
}
