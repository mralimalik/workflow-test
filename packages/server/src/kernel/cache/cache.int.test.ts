import { setTimeout as sleep } from 'node:timers/promises';

import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { CacheService, defineCacheNamespace } from './cache.service';

const settings = defineCacheNamespace({
  name: 'org-settings',
  ttlSeconds: 600,
  schema: z.object({ timezone: z.string(), locale: z.string() }),
});
const avail = defineCacheNamespace({
  name: 'avail',
  ttlSeconds: 60,
  schema: z.array(z.string()),
  versionFamily: 'avail',
});

let redis: Redis;
let cache: CacheService;

beforeAll(() => {
  redis = new Redis(process.env['REDIS_CACHE_URL']!);
  cache = new CacheService(redis, `att:${process.env['REDIS_KEY_NAMESPACE']!}`);
});
afterAll(async () => {
  await redis.quit();
});

describe('CacheService (BACKEND.md §9)', () => {
  it('cache-aside: loads once, then serves from Redis', async () => {
    let loads = 0;
    const loader = () => {
      loads++;
      return Promise.resolve({ timezone: 'Europe/Berlin', locale: 'de' });
    };
    expect(await cache.getOrLoad(settings, ['org-1'], loader)).toEqual({
      timezone: 'Europe/Berlin',
      locale: 'de',
    });
    expect(await cache.getOrLoad(settings, ['org-1'], loader)).toEqual({
      timezone: 'Europe/Berlin',
      locale: 'de',
    });
    expect(loads).toBe(1);
  });

  it('stampede: 50 concurrent reads of a cold key issue one load', async () => {
    let loads = 0;
    const loader = async () => {
      loads++;
      await sleep(100);
      return { timezone: 'UTC', locale: 'en' };
    };
    const results = await Promise.all(
      Array.from({ length: 50 }, () => cache.getOrLoad(settings, ['org-stampede'], loader)),
    );
    expect(loads).toBe(1);
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it('invalidate() removes an entry so the next read reloads', async () => {
    let loads = 0;
    const loader = () => Promise.resolve({ timezone: `v${++loads}`, locale: 'en' });
    await cache.getOrLoad(settings, ['org-inv'], loader);
    await cache.invalidate(settings, ['org-inv']);
    expect((await cache.getOrLoad(settings, ['org-inv'], loader)).timezone).toBe('v2');
  });

  it('version tokens invalidate a whole family at once', async () => {
    let loads = 0;
    const loader = () => Promise.resolve([`slots-${++loads}`]);
    await cache.getOrLoad(avail, ['loc-1', 'svc-a', '2026-10-12'], loader);
    await cache.getOrLoad(avail, ['loc-1', 'svc-b', '2026-10-12'], loader);
    expect(loads).toBe(2);
    await cache.bumpVersion('avail', 'loc-1');
    await cache.getOrLoad(avail, ['loc-1', 'svc-a', '2026-10-12'], loader);
    await cache.getOrLoad(avail, ['loc-1', 'svc-b', '2026-10-12'], loader);
    expect(loads).toBe(4);
  });

  it('a cached value that fails its schema is a miss (safe across deploys)', async () => {
    const key = await cache.key(settings, ['org-bad']);
    await redis.set(key, JSON.stringify({ timezone: 42 }));
    const value = await cache.getOrLoad(settings, ['org-bad'], () =>
      Promise.resolve({ timezone: 'UTC', locale: 'en' }),
    );
    expect(value).toEqual({ timezone: 'UTC', locale: 'en' });
  });

  it('keys are namespaced and TTLs jittered within ±10%', async () => {
    await cache.getOrLoad(settings, ['org-ttl'], () =>
      Promise.resolve({ timezone: 'UTC', locale: 'en' }),
    );
    const key = await cache.key(settings, ['org-ttl']);
    expect(key).toBe(`att:${process.env['REDIS_KEY_NAMESPACE']!}:org-settings:org-ttl:v0`);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThanOrEqual(540);
    expect(ttl).toBeLessThanOrEqual(660);
  });
});
