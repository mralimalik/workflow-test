import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Database } from '../db/database';
import { newId } from '../ids/ids';

let owner: Pool;
let db: Database;
const system = { type: 'system', id: 'maintenance' } as const;

beforeAll(() => {
  owner = new Pool({ connectionString: process.env['DATABASE_MIGRATION_URL']!, max: 1 });
  db = new Database({
    connectionString: process.env['DATABASE_URL']!,
    poolMax: 2,
    statementTimeoutMs: 5_000,
    applicationName: 'pm-test',
  });
});
afterAll(async () => {
  await db.onModuleDestroy();
  await owner.end();
});

async function partitions(parent: string): Promise<string[]> {
  const { rows } = await owner.query<{ name: string }>(
    `select c.relname as name from pg_inherits i join pg_class c on c.oid = i.inhrelid
      where i.inhparent = $1::regclass order by 1`,
    [parent],
  );
  return rows.map((r) => r.name);
}

describe('partition maintenance (data model 14)', () => {
  it('creates monthly partitions ahead, idempotently, without direct app access', async () => {
    const before = await partitions('audit_logs');
    await db.platformTx({ actor: system, reason: 'test' }, (tx) =>
      tx.execute(sql`select attendra_ensure_monthly_partitions('audit_logs'::regclass, 4)`),
    );
    await db.platformTx({ actor: system, reason: 'test' }, (tx) =>
      tx.execute(sql`select attendra_ensure_monthly_partitions('audit_logs'::regclass, 4)`),
    );
    const after = await partitions('audit_logs');
    expect(after.length).toBe(before.length + 2);
    expect(after).toContain('audit_logs_default');
    const denied = await db.pool
      .query(`select 1 from ${after.find((p) => p !== 'audit_logs_default')!}`)
      .catch((e: unknown) => e);
    expect(String(denied)).toMatch(/permission denied/);
  });

  it('drops expired outbox partitions only when nothing is left unpublished', async () => {
    await owner.query(`
      CREATE TABLE outbox_events_y2020m01 PARTITION OF outbox_events FOR VALUES FROM ('2020-01-01') TO ('2020-02-01');
      CREATE TABLE outbox_events_y2020m02 PARTITION OF outbox_events FOR VALUES FROM ('2020-02-01') TO ('2020-03-01');
    `);
    await owner.query(
      `insert into outbox_events (id, created_at, aggregate_type, aggregate_id, event_type, payload)
       values ($1, '2020-02-10', 'probe', $2, 'probe.happened', '{}')`,
      [newId(), newId()],
    );
    const dropped = await db.platformTx({ actor: system, reason: 'test' }, (tx) =>
      tx.execute<{ name: string }>(
        sql`select attendra_drop_old_partitions('outbox_events'::regclass, '14 days'::interval, 'published_at IS NULL') as name`,
      ),
    );
    expect(dropped.rows.map((r) => r.name)).toEqual(['outbox_events_y2020m01']);
    expect(await partitions('outbox_events')).toContain('outbox_events_y2020m02');
  });
});
