import { setTimeout as sleep } from 'node:timers/promises';

import { Injectable, type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { featureFlagChanged } from '@attendra/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WorkerModule } from '../src/apps/worker.module';
import { Database } from '../src/kernel/db/database';
import { newId } from '../src/kernel/ids/ids';
import { FeatureFlags } from '../src/modules/feature-flags/feature-flags.public';
import {
  HandlesWebhooks,
  InboundWebhookStore,
  type InboundWebhookHandler,
  type StoredWebhook,
} from '../src/modules/inbound-webhooks/inbound-webhooks.public';
import { OutboxWriter } from '../src/modules/outbox/outbox.public';
import { LogSink } from './support/log-sink';

const handled: StoredWebhook[] = [];

@HandlesWebhooks('stripe')
@Injectable()
class StripeTestHandler implements InboundWebhookHandler {
  handle(webhook: StoredWebhook): Promise<'processed' | 'ignored'> {
    handled.push(webhook);
    return Promise.resolve(webhook.eventType === 'invoice.paid' ? 'processed' : 'ignored');
  }
}

let app: INestApplicationContext;
let db: Database;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.forRoot({ logDestination: new LogSink() })],
    providers: [StripeTestHandler],
  }).compile();
  await moduleRef.init();
  app = moduleRef;
  db = app.get(Database);
});
afterAll(async () => {
  await app.close();
});

async function eventually<T>(
  read: () => Promise<T>,
  accept: (v: T) => boolean,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (accept(value)) return value;
    if (Date.now() > deadline)
      throw new Error(`Condition not met; last value: ${JSON.stringify(value)}`);
    await sleep(50);
  }
}

describe('feature flags (FR-ADM-005)', () => {
  it('evaluates from cache and re-reads after a feature_flag.changed event', async () => {
    const flags = app.get(FeatureFlags);
    const outbox = app.get(OutboxWriter);
    const flagId = newId();
    const orgId = newId();
    await db.transaction((tx) =>
      tx.execute(
        sql`insert into feature_flags (id, key, description, default_value) values (${flagId}, 'ordering.enabled', 'Food ordering', 'false')`,
      ),
    );
    expect(await flags.isEnabled('ordering.enabled', { organizationId: orgId })).toBe(false);

    // Change without an event: the cached value is still served.
    await db.transaction((tx) =>
      tx.execute(sql`insert into feature_flag_overrides (id, feature_flag_id, scope_type, scope_id, value)
                     values (${newId()}, ${flagId}, 'organization', ${orgId}, 'true')`),
    );
    expect(await flags.isEnabled('ordering.enabled', { organizationId: orgId })).toBe(false);

    // The event (written like any producer would) invalidates through the outbox relay.
    await db.transaction((tx) =>
      outbox.write(tx, featureFlagChanged, {
        aggregateId: flagId,
        organizationId: null,
        data: { key: 'ordering.enabled' },
      }),
    );
    await eventually(
      () => flags.isEnabled('ordering.enabled', { organizationId: orgId }),
      (v) => v,
    );
    expect(await flags.isEnabled('ordering.enabled', { organizationId: newId() })).toBe(false);
  });

  it('unknown flags are off', async () => {
    expect(await app.get(FeatureFlags).isEnabled('does.not_exist')).toBe(false);
  });
});

describe('inbound webhooks (BACKEND.md §5.11)', () => {
  it('stores, deduplicates and processes through the provider handler', async () => {
    const store = app.get(InboundWebhookStore);
    const eventId = `evt_${newId()}`;
    const first = await store.receive({
      provider: 'stripe',
      providerEventId: eventId,
      eventType: 'invoice.paid',
      payload: { amount: 100 },
      signatureValid: true,
    });
    const second = await store.receive({
      provider: 'stripe',
      providerEventId: eventId,
      eventType: 'invoice.paid',
      payload: { amount: 100 },
      signatureValid: true,
    });
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);

    const status = await eventually(
      () =>
        db.platformTx({ actor: { type: 'system', id: 'test' }, reason: 'test' }, (tx) =>
          tx.execute<{ status: string; attempts: number }>(
            sql`select status, attempts from inbound_webhook_events where id = ${first.id}`,
          ),
        ),
      (r) => r.rows[0]?.status === 'processed',
    );
    expect(status.rows[0]).toEqual({ status: 'processed', attempts: 1 });
    expect(handled.filter((h) => h.providerEventId === eventId)).toHaveLength(1);
  });

  it('stores invalid signatures as rejected and never processes them', async () => {
    const store = app.get(InboundWebhookStore);
    const { id } = await store.receive({
      provider: 'stripe',
      providerEventId: `evt_${newId()}`,
      eventType: 'invoice.paid',
      payload: {},
      signatureValid: false,
    });
    await sleep(500);
    const row = await db.platformTx(
      { actor: { type: 'system', id: 'test' }, reason: 'test' },
      (tx) =>
        tx.execute<{ status: string }>(
          sql`select status from inbound_webhook_events where id = ${id}`,
        ),
    );
    expect(row.rows[0]?.status).toBe('rejected');
  });

  it('marks webhooks without a handler as ignored; tenants cannot read them', async () => {
    const store = app.get(InboundWebhookStore);
    const { id } = await store.receive({
      provider: 'twilio',
      providerEventId: `SM${newId()}`,
      eventType: 'message.status',
      payload: {},
      signatureValid: true,
    });
    await eventually(
      () =>
        db.platformTx({ actor: { type: 'system', id: 'test' }, reason: 'test' }, (tx) =>
          tx.execute<{ status: string }>(
            sql`select status from inbound_webhook_events where id = ${id}`,
          ),
        ),
      (r) => r.rows[0]?.status === 'ignored',
    );
    const asTenant = await db.tenantTx(
      { organizationId: newId(), actor: { type: 'user', id: newId() } },
      (tx) => tx.execute(sql`select id from inbound_webhook_events`),
    );
    expect(asTenant.rows).toEqual([]);
  });
});
