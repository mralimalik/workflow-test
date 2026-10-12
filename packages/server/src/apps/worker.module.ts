import { Module } from '@nestjs/common';

import { AuditModule } from '../modules/audit/audit.public';
import {
  NotificationsModule,
  NotificationsWorkerModule,
} from '../modules/notifications/notifications.public';
import { FeatureFlagsModule } from '../modules/feature-flags/feature-flags.public';
import {
  InboundWebhooksModule,
  InboundWebhooksWorkerModule,
} from '../modules/inbound-webhooks/inbound-webhooks.public';
import { IdempotencyModule } from '../modules/idempotency/idempotency.public';
import { OutboxModule, OutboxRelayModule } from '../modules/outbox/outbox.public';
import { CacheModule } from '../kernel/cache/cache.module';
import { DatabaseModule } from '../kernel/db/database.module';
import { KernelModule, type KernelOptions } from '../kernel/kernel.module';
import { MaintenanceModule } from '../kernel/maintenance/maintenance.module';
import { QueueModule } from '../kernel/queue/queue.module';
import { RedisModule } from '../kernel/redis/redis.module';

/**
 * Composition root for the `worker` process (BullMQ consumers, schedulers, outbox relay).
 * Processors are registered here as modules add jobs (BACKEND.md §10).
 */
@Module({})
export class WorkerModule {
  static forRoot(options: Omit<KernelOptions, 'app'> = {}) {
    return {
      module: WorkerModule,
      imports: [
        KernelModule.forRoot({ app: 'worker', ...options }),
        DatabaseModule.forRoot({ statementTimeoutMs: 60_000, applicationName: 'attendra-worker' }),
        RedisModule,
        CacheModule,
        QueueModule,
        AuditModule,
        OutboxModule,
        OutboxRelayModule,
        IdempotencyModule,
        NotificationsModule,
        NotificationsWorkerModule,
        FeatureFlagsModule,
        InboundWebhooksModule,
        InboundWebhooksWorkerModule,
        MaintenanceModule,
      ],
    };
  }
}
