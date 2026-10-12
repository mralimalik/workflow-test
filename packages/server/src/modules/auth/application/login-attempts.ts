import type { Realm } from '@attendra/contracts';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { sha256 } from '../../../kernel/crypto/secrets';
import { RateLimitedError } from '../../../kernel/errors/app-error';
import { REDIS_CACHE, REDIS_KEY_PREFIX } from '../../../kernel/redis/redis.module';

const WINDOW_MS = 15 * 60_000;
/** Failed attempts per account per window, from any IP (the `auth.login` policy is per IP). */
const MAX_FAILURES = 10;

/**
 * Per-account lockout (FR-AUTH, plan A4): after 10 failed password or code checks within 15
 * minutes the account refuses logins until the window passes, whichever IP they come from.
 * Successful logins clear the counter.
 */
@Injectable()
export class LoginAttempts {
  constructor(
    @Inject(REDIS_CACHE) private readonly redis: Redis,
    @Inject(REDIS_KEY_PREFIX) private readonly prefix: string,
  ) {}

  async assertNotLocked(realm: Realm, identifier: string): Promise<void> {
    const key = this.key(realm, identifier);
    const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.pttl(key)]);
    if (Number(count ?? 0) >= MAX_FAILURES) throw new RateLimitedError(Math.max(ttl, 1000) / 1000);
  }

  async recordFailure(realm: Realm, identifier: string): Promise<void> {
    const key = this.key(realm, identifier);
    await this.redis.multi().incr(key).pexpire(key, WINDOW_MS, 'NX').exec();
  }

  async clear(realm: Realm, identifier: string): Promise<void> {
    await this.redis.del(this.key(realm, identifier));
  }

  private key(realm: Realm, identifier: string): string {
    return `${this.prefix}:login-fail:${realm}:${sha256(identifier.toLowerCase()).toString('base64url')}`;
  }
}
