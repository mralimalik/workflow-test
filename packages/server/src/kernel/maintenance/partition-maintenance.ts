import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { Database } from '../db/database';
import { MaintenanceTaskProvider, type MaintenanceTask } from './maintenance';

/** Monthly-partitioned tables and how long expired partitions are kept. */
export const PARTITIONED_TABLES: readonly {
  table: string;
  drop?: { keep: string; stillNeeded?: string };
}[] = [
  { table: 'audit_logs' },
  { table: 'inbound_webhook_events' },
  { table: 'notifications' },
  { table: 'outbox_events', drop: { keep: '14 days', stillNeeded: 'published_at IS NULL' } },
];

const MONTHS_AHEAD = 2;

/** `partition-maintain` (nightly): create partitions ahead, drop expired ones. */
@MaintenanceTaskProvider()
@Injectable()
export class PartitionMaintenanceTask implements MaintenanceTask {
  readonly name = 'partition-maintain';
  readonly schedule = '15 3 * * *';

  constructor(private readonly db: Database) {}

  run(): Promise<{ dropped: string[] }> {
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
