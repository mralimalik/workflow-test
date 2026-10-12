import { Module } from '@nestjs/common';

import { DatabaseModule } from '../kernel/db/database.module';
import { KernelModule, type KernelOptions } from '../kernel/kernel.module';

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
      ],
    };
  }
}
