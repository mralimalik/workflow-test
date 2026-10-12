import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

import { REDIS_CACHE, REDIS_KEY_PREFIX } from '../redis/redis.module';

/**
 * Sliding-window log in a Redis sorted set, atomic in one Lua call (BACKEND.md §9.3).
 * Members are timestamps (plus a sequence for uniqueness); hits older than the window are
 * dropped on every call. When the limit is exceeded the key is blocked for blockDuration.
 *
 * KEYS[1] window zset, KEYS[2] block marker, KEYS[3] sequence
 * ARGV[1] now ms, ARGV[2] window ms, ARGV[3] limit, ARGV[4] block ms
 * returns { totalHits, msToExpire, blocked(0/1), msToBlockExpire }
 */
const SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local block = tonumber(ARGV[4])
local blockTtl = redis.call('PTTL', KEYS[2])
if blockTtl > 0 then
  return { redis.call('ZCARD', KEYS[1]), window, 1, blockTtl }
end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local seq = redis.call('INCR', KEYS[3])
redis.call('PEXPIRE', KEYS[3], window)
redis.call('ZADD', KEYS[1], now, now .. '-' .. seq)
redis.call('PEXPIRE', KEYS[1], window)
local hits = redis.call('ZCARD', KEYS[1])
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local expire = window
if oldest[2] then expire = math.max(0, tonumber(oldest[2]) + window - now) end
if hits > limit then
  redis.call('SET', KEYS[2], '1', 'PX', block)
  return { hits, expire, 1, block }
end
return { hits, expire, 0, 0 }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(
    @Inject(REDIS_CACHE) private readonly redis: Redis,
    @Inject(REDIS_KEY_PREFIX) private readonly prefix: string,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ) {
    const base = `${this.prefix}:rl:${throttlerName}:${key}`;
    const [totalHits, msToExpire, blocked, msToBlockExpire] = (await this.redis.eval(
      SCRIPT,
      3,
      `${base}:w`,
      `${base}:b`,
      `${base}:s`,
      Date.now(),
      ttl,
      limit,
      blockDuration > 0 ? blockDuration : ttl,
    )) as [number, number, number, number];
    return {
      totalHits,
      timeToExpire: Math.ceil(msToExpire / 1000),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.ceil(msToBlockExpire / 1000),
    };
  }
}
