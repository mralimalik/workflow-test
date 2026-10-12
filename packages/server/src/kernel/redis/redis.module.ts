import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';

import { AppConfig } from '../config/app-config';
import { ReadinessCheckProvider, type ReadinessCheck } from '../health/health-indicators';

/**
 * Two Redis connections (BACKEND.md §9, ADR-0008): cache/sessions/rate limits on one,
 * BullMQ on the other — separate instances in production with different eviction policies.
 */
export const REDIS_CACHE = Symbol('REDIS_CACHE');
export const REDIS_QUEUE = Symbol('REDIS_QUEUE');

/** Key prefix `att:{env}` shared by every Redis key (BACKEND.md §9.1). */
export const REDIS_KEY_PREFIX = Symbol('REDIS_KEY_PREFIX');

function connect(url: string, name: string, forQueue: boolean): Redis {
  return new Redis(url, {
    connectionName: `attendra-${name}`,
    // BullMQ workers need blocking commands that never give up (BullMQ docs: connections).
    maxRetriesPerRequest: forQueue ? null : 3,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    @Inject(REDIS_QUEUE) private readonly queue: Redis,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.cache.quit(), this.queue.quit()]);
  }
}

@ReadinessCheckProvider()
@Injectable()
export class RedisReadinessCheck implements ReadinessCheck {
  readonly key = 'redis';

  constructor(
    @Inject(REDIS_CACHE) private readonly cache: Redis,
    @Inject(REDIS_QUEUE) private readonly queue: Redis,
    private readonly indicators: HealthIndicatorService,
  ) {}

  check() {
    return this.indicators
      .check(this.key)
      .attempt(async () => {
        await Promise.all([this.cache.ping(), this.queue.ping()]);
      })
      .withTimeout(2000);
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CACHE,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        connect(config.get('REDIS_CACHE_URL', { infer: true }), 'cache', false),
    },
    {
      provide: REDIS_QUEUE,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        connect(config.get('REDIS_QUEUE_URL', { infer: true }), 'queue', true),
    },
    {
      provide: REDIS_KEY_PREFIX,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        `att:${config.get('REDIS_KEY_NAMESPACE', { infer: true }) ?? config.get('APP_ENV', { infer: true })}`,
    },
    RedisLifecycle,
    HealthIndicatorService,
    RedisReadinessCheck,
  ],
  exports: [REDIS_CACHE, REDIS_QUEUE, REDIS_KEY_PREFIX],
})
export class RedisModule {}
