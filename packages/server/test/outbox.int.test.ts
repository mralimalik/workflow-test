import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable, type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { defineEvent, type EventEnvelope } from '@attendra/contracts';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { LogSink } from './support/log-sink';
import { WorkerModule } from '../src/apps/worker.module';
import { Database } from '../src/kernel/db/database';
import { newId } from '../src/kernel/ids/ids';
import { AuditService } from '../src/modules/audit/audit.public';
import {
  HandlesEvents,
  OutboxWriter,
  type DomainEventHandler,
} from '../src/modules/outbox/outbox.public';

const probeHappened = defineEvent({
  type: 'probe.happened',
  version: 1,
  aggregate: 'probe',
  data: z.object({ n: z.int() }),
});

const deliveries = new Map<string, number>();

@HandlesEvents({ consumer: 'probe-counter', events: ['probe.happened'] })
@Injectable()
class ProbeCounter implements DomainEventHandler {
  handle(event: EventEnvelope): Promise<void> {
    deliveries.set(event.id, (deliveries.get(event.id) ?? 0) + 1);
    return Promise.resolve();
  }
}

async function bootWorker(): Promise<INestApplicationContext> {
  const moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.forRoot({ logDestination: new LogSink() })],
    providers: [ProbeCounter],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

const orgA = newId();
const actor = { type: 'user', id: newId() } as const;
let workers: INestApplicationContext[] = [];

beforeAll(async () => {
  workers = [await bootWorker(), await bootWorker()];
});
afterAll(async () => {
  for (const w of workers) await w.close();
});

async function waitFor(predicate: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await sleep(50);
  }
}

describe('transactional outbox + relay (BACKEND.md §10.1)', () => {
  it('publishes committed events exactly once with 2 relay instances; never rolled-back ones', async () => {
    const db = workers[0]!.get(Database);
    const outbox = workers[0]!.get(OutboxWriter);

    let rolledBackId = '';
    await db
      .tenantTx({ organizationId: orgA, actor }, async (tx) => {
        rolledBackId = await outbox.write(tx, probeHappened, {
          aggregateId: newId(),
          organizationId: orgA,
          data: { n: -1 },
        });
        throw new Error('roll back');
      })
      .catch(() => undefined);

    const committed: string[] = [];
    for (let i = 0; i < 30; i++) {
      committed.push(
        await db.tenantTx({ organizationId: orgA, actor }, (tx) =>
          outbox.write(tx, probeHappened, {
            aggregateId: newId(),
            organizationId: orgA,
            data: { n: i },
          }),
        ),
      );
    }

    await waitFor(() => committed.every((id) => deliveries.has(id)));
    await sleep(1_500); // give a duplicate the chance to appear
    expect(committed.map((id) => deliveries.get(id))).toEqual(committed.map(() => 1));
    expect(deliveries.has(rolledBackId)).toBe(false);

    const owner = new Pool({ connectionString: process.env['DATABASE_MIGRATION_URL']!, max: 1 });
    try {
      const { rows } = await owner.query<{ unpublished: number }>(
        `select count(*)::int as unpublished from outbox_events where published_at is null`,
      );
      expect(rows[0]!.unpublished).toBe(0);
    } finally {
      await owner.end();
    }
  });

  it('rejects invalid event data at write time', async () => {
    const db = workers[0]!.get(Database);
    const outbox = workers[0]!.get(OutboxWriter);
    await expect(
      db.tenantTx({ organizationId: orgA, actor }, (tx) =>
        outbox.write(tx, probeHappened, {
          aggregateId: newId(),
          organizationId: orgA,
          data: { n: 'x' as unknown as number },
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('audit log (NFR-SEC-007)', () => {
  it('records in the caller transaction, is tenant-isolated and append-only', async () => {
    const db = workers[0]!.get(Database);
    const audit = workers[0]!.get(AuditService);
    const orgB = newId();
    const target = { type: 'probe', id: newId() };
    await db.tenantTx({ organizationId: orgA, actor }, (tx) =>
      audit.record(tx, {
        action: 'probe.updated',
        organizationId: orgA,
        target,
        changes: { name: ['a', 'b'], password: ['x', 'y'] },
      }),
    );
    await db
      .tenantTx({ organizationId: orgA, actor }, async (tx) => {
        await audit.record(tx, { action: 'probe.deleted', organizationId: orgA, target });
        throw new Error('roll back');
      })
      .catch(() => undefined);

    const own = await db.tenantTx({ organizationId: orgA, actor }, (tx) =>
      tx.execute<{ action: string; changes: Record<string, unknown> }>(
        sql`select action, changes from audit_logs where target_id = ${target.id}`,
      ),
    );
    expect(own.rows).toEqual([
      { action: 'probe.updated', changes: { name: ['a', 'b'], password: '[redacted]' } },
    ]);

    const otherRows = await db.tenantTx({ organizationId: orgB, actor }, (tx) =>
      tx.execute(sql`select * from audit_logs`),
    );
    expect(otherRows.rows).toEqual([]);

    const update = await db
      .tenantTx({ organizationId: orgA, actor }, (tx) =>
        tx.execute(sql`update audit_logs set action = 'probe.hacked'`),
      )
      .catch((e: unknown) => e);
    expect(String((update as { cause?: unknown }).cause ?? update)).toMatch(/permission denied/);
  });
});
