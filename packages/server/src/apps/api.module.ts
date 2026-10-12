import { Module } from '@nestjs/common';

import { DatabaseModule } from '../kernel/db/database.module';
import { HealthModule } from '../kernel/health/health.module';
import { KernelModule, type KernelOptions } from '../kernel/kernel.module';

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
        HealthModule,
      ],
    };
  }
}
