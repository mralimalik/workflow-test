import { Module } from '@nestjs/common';

import { AdminModule } from '../modules/admin/admin.public';
import { AuditModule } from '../modules/audit/audit.public';
import { PlatformAdminsModule } from '../modules/platform-admins/platform-admins.public';
import { AuthModule, SessionSocketAuthenticator } from '../modules/auth/auth.public';
import { UsersModule } from '../modules/users/users.public';
import {
  RealtimeGatewayModule,
  RealtimePublisherModule,
} from '../modules/realtime/realtime.public';
import { NotificationsModule } from '../modules/notifications/notifications.public';
import { FeatureFlagsModule } from '../modules/feature-flags/feature-flags.public';
import { InboundWebhooksModule } from '../modules/inbound-webhooks/inbound-webhooks.public';
import { FilesModule } from '../modules/files/files.public';
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
        RealtimePublisherModule,
        NotificationsModule,
        FeatureFlagsModule,
        InboundWebhooksModule,
        FilesModule,
        UsersModule,
        PlatformAdminsModule,
        // Before RateLimitModule: its guard keys limits by the actor this guard resolves.
        AuthModule,
        RealtimeGatewayModule.register({
          imports: [AuthModule],
          authenticator: SessionSocketAuthenticator,
        }),
        AdminModule,
        RateLimitModule,
        HealthModule,
      ],
    };
  }
}
