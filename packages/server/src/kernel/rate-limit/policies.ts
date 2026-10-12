import { createHash } from 'node:crypto';

import type { RateLimitPolicyName } from '@attendra/contracts';
import type { Request } from 'express';

import { RequestContext } from '../context/request-context';

/**
 * Rate-limit policies (BACKEND.md §9.3). `default` applies to every route; the others apply
 * only to routes that name them in their contract (`rateLimit`). Limits are in requests per
 * window.
 */
export interface RateLimitPolicy {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
  /** How long a caller stays blocked after exceeding the limit. Defaults to the window. */
  readonly blockMs?: number;
  /** What the limit counts per (IP, identifier, subject…). */
  tracker(req: Request): string;
}

const MINUTE = 60_000;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 22);
}

/** Identifier fields that login-like requests send (normalized, hashed; never stored raw). */
function identifierOf(req: Request): string {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const raw = [body['email'], body['phone'], body['identifier']].find((v) => typeof v === 'string');
  return typeof raw === 'string' ? hash(raw.trim().toLowerCase()) : 'none';
}

function subjectOf(req: Request): string {
  const ctx = RequestContext.get();
  if (ctx?.actor)
    return `${ctx.actor.type}:${ctx.actor.id}${ctx.organizationId ? `:${ctx.organizationId}` : ''}`;
  return `ip:${req.ip ?? 'unknown'}`;
}

export const RATE_LIMIT_POLICIES: Readonly<
  Record<RateLimitPolicyName | 'default', RateLimitPolicy>
> = {
  default: { name: 'default', limit: 600, windowMs: MINUTE, tracker: subjectOf },
  'auth.login': {
    name: 'auth.login',
    limit: 10,
    windowMs: 15 * MINUTE,
    tracker: (req) => `${req.ip ?? 'unknown'}:${identifierOf(req)}`,
  },
  /** Password reset / verification link requests: per IP and per identifier. */
  'auth.link': {
    name: 'auth.link',
    limit: 5,
    windowMs: 60 * MINUTE,
    tracker: (req) => `${req.ip ?? 'unknown'}:${identifierOf(req)}`,
  },
  'public.write': {
    name: 'public.write',
    limit: 30,
    windowMs: MINUTE,
    tracker: (req) => req.ip ?? 'unknown',
  },
};
