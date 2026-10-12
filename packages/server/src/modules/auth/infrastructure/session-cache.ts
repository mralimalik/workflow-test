import { REALMS } from '@attendra/contracts';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { z } from 'zod';

import { REDIS_CACHE, REDIS_KEY_PREFIX } from '../../../kernel/redis/redis.module';
import { SESSION_AUTH_METHODS } from './auth.schema';

/** The `session` cache entry (BACKEND.md §9.2). Keyed by the token hash, never the token. */
export const cachedSessionSchema = z.object({
  id: z.string(),
  realm: z.enum(REALMS),
  subjectId: z.string(),
  subjectVersion: z.int(),
  /** Admin role at load time; role changes refresh the subject's cached sessions. */
  role: z.string().nullable(),
  csrfToken: z.string(),
  authMethod: z.enum(SESSION_AUTH_METHODS),
  mfaVerifiedAt: z.iso.datetime().nullable(),
  /** The subject must enrol in MFA before business endpoints accept the session. */
  mfaPending: z.boolean(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
  idleExpiresAt: z.iso.datetime(),
  absoluteExpiresAt: z.iso.datetime(),
});
export type CachedSession = z.infer<typeof cachedSessionSchema>;

/** How long a revocation tombstone blocks re-caching (covers loads racing a revoke). */
const TOMBSTONE_MS = 5 * 60_000;

/** SET the entry unless the session was revoked meanwhile (KEYS[1] entry, KEYS[2] tombstone). */
const PUT_UNLESS_REVOKED = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`;

/**
 * Hot copy of sessions in Redis. Postgres stays the source of truth: a miss reloads the
 * row. Revocation deletes the entry and leaves a short tombstone (`revoked-sid`) so a load
 * that read the row before the revoke cannot write it back.
 */
@Injectable()
export class SessionCache {
  private readonly logger = new Logger(SessionCache.name);

  constructor(
    @Inject(REDIS_CACHE) private readonly redis: Redis,
    @Inject(REDIS_KEY_PREFIX) private readonly prefix: string,
  ) {}

  async get(tokenHash: string): Promise<CachedSession | null> {
    const raw = await this.redis.get(this.key(tokenHash));
    if (!raw) return null;
    const parsed = cachedSessionSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      this.logger.warn('Discarding malformed session cache entry');
      return null;
    }
    return parsed.data;
  }

  async put(tokenHash: string, entry: CachedSession, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) return;
    await this.redis.eval(
      PUT_UNLESS_REVOKED,
      2,
      this.key(tokenHash),
      this.tombstoneKey(tokenHash),
      JSON.stringify(entry),
      Math.ceil(ttlMs),
    );
  }

  /** Revoked: drop the entry and block re-caching. */
  async evict(tokenHashes: readonly string[]): Promise<void> {
    if (tokenHashes.length === 0) return;
    const multi = this.redis.multi();
    for (const hash of tokenHashes) {
      multi.set(this.tombstoneKey(hash), '1', 'PX', TOMBSTONE_MS);
      multi.del(this.key(hash));
    }
    await multi.exec();
  }

  /** Still valid but changed (e.g. MFA state): drop so the next request reloads it. */
  async refresh(tokenHashes: readonly string[]): Promise<void> {
    if (tokenHashes.length === 0) return;
    await this.redis.del(...tokenHashes.map((h) => this.key(h)));
  }

  private key(tokenHash: string): string {
    return `${this.prefix}:session:${tokenHash}`;
  }

  private tombstoneKey(tokenHash: string): string {
    return `${this.prefix}:revoked-sid:${tokenHash}`;
  }
}
