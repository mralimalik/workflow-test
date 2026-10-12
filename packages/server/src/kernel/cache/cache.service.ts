import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { z } from 'zod';

import { REDIS_CACHE, REDIS_KEY_PREFIX } from '../redis/redis.module';

/**
 * A cache family from the catalogue (BACKEND.md §9.2). Every namespace used in code is
 * declared once with its TTL; keys are always scoped by ids.
 */
export interface CacheNamespace<S extends z.ZodType> {
  readonly name: string;
  readonly ttlSeconds: number;
  /** Contents schema; a cached value that fails it is treated as a miss (safe across deploys). */
  readonly schema: S;
  /**
   * Version-token family (`ver:{versionFamily}:{scopeId}`) bumped to invalidate many keys at
   * once, e.g. all availability entries for a location.
   */
  readonly versionFamily?: string;
}

export function defineCacheNamespace<S extends z.ZodType>(
  ns: CacheNamespace<S>,
): CacheNamespace<S> {
  if (!/^[a-z][a-z0-9-]*$/.test(ns.name)) throw new Error(`Invalid cache namespace: ${ns.name}`);
  return ns;
}

const LOCK_TTL_MS = 5_000;
const LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 25;

/**
 * Cache-aside over Redis (BACKEND.md §9.1): Postgres stays the source of truth; never used
 * on write paths. Single-flight per key prevents stampedes; TTLs are jittered ±10%.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);

  constructor(
    @Inject(REDIS_CACHE) private readonly redis: Redis,
    @Inject(REDIS_KEY_PREFIX) private readonly prefix: string,
  ) {}

  /** `att:{env}:{namespace}:{ids…}:v{version}` */
  async key(ns: CacheNamespace<z.ZodType>, ids: readonly string[]): Promise<string> {
    const scope = ids.join(':');
    const version = ns.versionFamily
      ? await this.currentVersion(ns.versionFamily, ids[0] ?? 'global')
      : 0;
    return `${this.prefix}:${ns.name}:${scope}:v${version}`;
  }

  /** Returns the cached value or loads, stores and returns it. At most one loader runs per key. */
  async getOrLoad<S extends z.ZodType>(
    ns: CacheNamespace<S>,
    ids: readonly string[],
    loader: () => Promise<z.output<S>>,
  ): Promise<z.output<S>> {
    const key = await this.key(ns, ids);
    const hit = await this.read(ns, key);
    if (hit.found) return hit.value;

    const lockKey = `${key}:lock`;
    const token = randomUUID();
    const locked = (await this.redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
    if (!locked) {
      // Someone else is loading: wait briefly for their value, then fall back to loading.
      const deadline = Date.now() + LOCK_WAIT_MS;
      while (Date.now() < deadline) {
        await sleep(LOCK_POLL_MS);
        const waited = await this.read(ns, key);
        if (waited.found) return waited.value;
      }
      return loader();
    }

    try {
      const value = await loader();
      await this.redis.set(key, JSON.stringify(value), 'EX', this.jitter(ns.ttlSeconds));
      return value;
    } finally {
      // Release only our own lock.
      await this.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lockKey,
        token,
      );
    }
  }

  /** Deletes one entry (current version). */
  async invalidate(ns: CacheNamespace<z.ZodType>, ids: readonly string[]): Promise<void> {
    await this.redis.del(await this.key(ns, ids));
  }

  /** Invalidates a whole family for a scope by bumping its version token. */
  async bumpVersion(family: string, scopeId: string): Promise<number> {
    return this.redis.incr(this.versionKey(family, scopeId));
  }

  private async currentVersion(family: string, scopeId: string): Promise<number> {
    const value = await this.redis.get(this.versionKey(family, scopeId));
    return value ? Number(value) : 0;
  }

  private versionKey(family: string, scopeId: string): string {
    return `${this.prefix}:ver:${family}:${scopeId}`;
  }

  private async read<S extends z.ZodType>(
    ns: CacheNamespace<S>,
    key: string,
  ): Promise<{ found: true; value: z.output<S> } | { found: false }> {
    const raw = await this.redis.get(key);
    if (raw === null) return { found: false };
    try {
      const parsed = ns.schema.safeParse(JSON.parse(raw));
      if (parsed.success) return { found: true, value: parsed.data };
    } catch {
      // fall through: corrupt entry
    }
    this.logger.warn({ namespace: ns.name }, 'Discarding cache entry that fails its schema');
    await this.redis.del(key);
    return { found: false };
  }

  private jitter(ttlSeconds: number): number {
    const spread = ttlSeconds * 0.1;
    return Math.max(1, Math.round(ttlSeconds - spread + Math.random() * 2 * spread));
  }
}
