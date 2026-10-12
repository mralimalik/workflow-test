import type { Realm } from '@attendra/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { randomToken, sha256 } from '../../../kernel/crypto/secrets';
import { REDIS_CACHE, REDIS_KEY_PREFIX } from '../../../kernel/redis/redis.module';
import { Clock } from '../../../kernel/time/clock';

export const MFA_LOGIN_TTL_MS = 5 * 60_000;
const MAX_ATTEMPTS = 5;

/** Atomic: never recreates an expired token, deletes it at the attempt limit. */
const RECORD_FAILURE = `
if redis.call('EXISTS', KEYS[1]) == 0 then return -1 end
local n = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if n >= tonumber(ARGV[1]) then redis.call('DEL', KEYS[1]) end
return n
`;

export interface PendingMfaLogin {
  realm: Realm;
  subjectId: string;
}

/**
 * The half-finished login between a correct password and the second factor: a single-use
 * token (stored hashed in Redis for 5 minutes) with at most 5 code attempts.
 */
@Injectable()
export class MfaLoginTokens {
  constructor(
    @Inject(REDIS_CACHE) private readonly redis: Redis,
    @Inject(REDIS_KEY_PREFIX) private readonly prefix: string,
    private readonly clock: Clock,
  ) {}

  async issue(pending: PendingMfaLogin): Promise<{ token: string; expiresAt: Date }> {
    const token = randomToken();
    const key = this.key(token);
    await this.redis
      .multi()
      .hset(key, { realm: pending.realm, subjectId: pending.subjectId, attempts: 0 })
      .pexpire(key, MFA_LOGIN_TTL_MS)
      .exec();
    return { token, expiresAt: new Date(this.clock.now().getTime() + MFA_LOGIN_TTL_MS) };
  }

  async peek(token: string): Promise<PendingMfaLogin | null> {
    const data = await this.redis.hgetall(this.key(token));
    if (!data['realm'] || !data['subjectId']) return null;
    return { realm: data['realm'] as Realm, subjectId: data['subjectId'] };
  }

  /** Counts a wrong code; the token dies after the last allowed attempt. */
  async recordFailure(token: string): Promise<void> {
    await this.redis.eval(RECORD_FAILURE, 1, this.key(token), MAX_ATTEMPTS);
  }

  /** Single use: true only for the one caller that deletes it. */
  async consume(token: string): Promise<boolean> {
    return (await this.redis.del(this.key(token))) === 1;
  }

  private key(token: string): string {
    return `${this.prefix}:mfa-login:${sha256(token).toString('base64url')}`;
  }
}
