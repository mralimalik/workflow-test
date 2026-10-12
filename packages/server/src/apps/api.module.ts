import { Module } from '@nestjs/common';

import { AuditModule } from '../modules/audit/audit.public';
import { IdempotencyModule } from '../modules/idempotency/idempotency.public';
import { OutboxModule } from '../modules/outbox/outbox.public';
import { CacheModule } from '../kernel/cache/cache.module';
import { DatabaseModule } from '../kernel/db/database.module';
import { HealthModule } from '../kernel/health/health.module';
import { KernelModule, type KernelOptions } from '../kernel/kernel.module';
import { RateLimitModule } from '../kernel/rate-limit/rate-limit.module';
import { QueueModule } from '../kernel/queue/queue.module';
import { RedisModule } from '../kernel/redis/redis.module';

/**
 * Composition root for the `api` process (HTTP, webhooks, WebSocket gateway). Feature
 * modules are registered here as they are built (BACKEND.md §2–3).
 */
@Module({})
export class ApiModule {
  static forRoot(options: Omit<KernelOptions, 'app'> = {}) {
    return {
      module: ApiModule,
      imports: [
        KernelModule.forRoot({ app: 'api', ...options }),
        DatabaseModule.forRoot({ statementTimeoutMs: 5_000, applicationName: 'attendra-api' }),
        RedisModule,
        CacheModule,
        QueueModule,
        AuditModule,
        OutboxModule,
        IdempotencyModule,
        RateLimitModule,
        HealthModule,
      ],
    };
  }
}
