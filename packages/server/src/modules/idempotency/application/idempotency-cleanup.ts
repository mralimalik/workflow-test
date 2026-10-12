import { Injectable } from '@nestjs/common';

import {
  MaintenanceTaskProvider,
  type MaintenanceTask,
} from '../../../kernel/maintenance/maintenance';
import { Clock } from '../../../kernel/time/clock';
import { IdempotencyRepository } from '../infrastructure/idempotency.repository';

/** `idempotency-cleanup` (nightly): removes expired keys (BACKEND.md §5.9). */
@MaintenanceTaskProvider()
@Injectable()
export class IdempotencyCleanupTask implements MaintenanceTask {
  readonly name = 'idempotency-cleanup';
  readonly schedule = '45 3 * * *';

  constructor(
    private readonly repository: IdempotencyRepository,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<{ deleted: number }> {
    return { deleted: await this.repository.deleteExpired(this.clock.now()) };
  }
}
