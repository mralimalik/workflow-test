import { Module } from '@nestjs/common';

import { AdminModule } from '../modules/admin/admin.public';
import { AuditModule } from '../modules/audit/audit.public';
import { FeatureFlagsModule } from '../modules/feature-flags/feature-flags.public';
import { OutboxModule } from '../modules/outbox/outbox.public';
import { PlatformAdminsModule } from '../modules/platform-admins/platform-admins.public';
import { UsersModule } from '../modules/users/users.public';
import { CacheModule } from '../kernel/cache/cache.module';
import { DatabaseModule } from '../kernel/db/database.module';
import { KernelModule } from '../kernel/kernel.module';
import { RedisModule } from '../kernel/redis/redis.module';

/** Composition root for operator CLIs (`pnpm admin:create`): no HTTP, no workers. */
@Module({
  imports: [
    KernelModule.forRoot({ app: 'cli' }),
    DatabaseModule.forRoot({ statementTimeoutMs: 30_000, applicationName: 'attendra-cli' }),
    RedisModule,
    CacheModule,
    AuditModule,
    OutboxModule,
    FeatureFlagsModule,
    UsersModule,
    PlatformAdminsModule,
    AdminModule,
  ],
})
export class AdminCliModule {}
