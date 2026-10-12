import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { sql } from 'drizzle-orm';

import { Database } from '../db/database';
import { AppProcessor } from '../queue/app-processor';
import { QUEUES } from '../queue/queues';

/** Monthly-partitioned tables and how long published/old partitions are kept. */
export const PARTITIONED_TABLES: readonly {
  table: string;
  drop?: { keep: string; stillNeeded?: string };
}[] = [
  { table: 'audit_logs' },
  { table: 'outbox_events', drop: { keep: '14 days', stillNeeded: 'published_at IS NULL' } },
];

const MONTHS_AHEAD = 2;

/** Nightly `maintenance/partition-maintain` (BACKEND.md §10.3): create ahead, drop expired. */
@Processor(QUEUES.maintenance)
export class MaintenanceProcessor extends AppProcessor {
  constructor(private readonly db: Database) {
    super();
  }

  protected async handle(job: Job): Promise<unknown> {
    if (job.name !== 'partition-maintain') return undefined;
    return this.db.platformTx(
      { actor: { type: 'system', id: 'maintenance' }, reason: 'partition maintenance' },
      async (tx) => {
        const dropped: string[] = [];
        for (const { table, drop } of PARTITIONED_TABLES) {
          await tx.execute(
            sql`select attendra_ensure_monthly_partitions(${table}::regclass, ${MONTHS_AHEAD})`,
          );
          if (drop) {
            const { rows } = await tx.execute<{ name: string }>(
              sql`select attendra_drop_old_partitions(${table}::regclass, ${drop.keep}::interval, ${drop.stillNeeded ?? null}) as name`,
            );
            dropped.push(...rows.map((r) => r.name));
          }
        }
        return { dropped };
      },
    );
  }
}

/** Registers recurring maintenance with BullMQ Job Schedulers (idempotent upsert). */
@Injectable()
export class MaintenanceSchedules implements OnApplicationBootstrap {
  constructor(@InjectQueue(QUEUES.maintenance) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'partition-maintain',
      { pattern: '15 3 * * *', tz: 'UTC' },
      { name: 'partition-maintain' },
    );
  }
}
