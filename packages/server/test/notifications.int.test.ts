import { setTimeout as sleep } from 'node:timers/promises';

import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { waitForEmail } from '../../../test/mailpit';
import { WorkerModule } from '../src/apps/worker.module';
import { Database } from '../src/kernel/db/database';
import { newId } from '../src/kernel/ids/ids';
import { NotificationDispatcher } from '../src/modules/notifications/notifications.public';
import { LogSink } from './support/log-sink';

let app: INestApplicationContext;
let db: Database;
let dispatcher: NotificationDispatcher;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.forRoot({ logDestination: new LogSink() })],
  }).compile();
  await moduleRef.init();
  app = moduleRef;
  db = app.get(Database);
  dispatcher = app.get(NotificationDispatcher);
});
afterAll(async () => {
  await app.close();
});

describe('email notifications (FR-NOT, A3)', () => {
  it('a queued notification is rendered, sent over SMTP and arrives in the inbox', async () => {
    const to = `verify-${newId()}@example.test`;
    const { notificationId } = await dispatcher.dispatch({
      organizationId: null,
      recipient: { type: 'address', destination: to },
      channel: 'email',
      eventKey: 'auth.verify_email',
      locale: 'en-GB',
      category: 'security',
      values: { firstName: 'Ana <b>', link: 'http://localhost:5173/verify?token=abc' },
    });

    const mail = await waitForEmail(to);
    expect(mail.summary.Subject).toBe('Confirm your email address');
    expect(mail.text).toContain('Hi Ana <b>,');
    expect(mail.text).toContain('http://localhost:5173/verify?token=abc');
    expect(mail.html).toContain('Ana &lt;b&gt;');

    for (let i = 0; i < 50; i++) {
      const { rows } = await db.transaction((tx) =>
        tx.execute<{ status: string; locale: string }>(
          sql`select status, locale from notifications where id = ${notificationId}`,
        ),
      );
      if (rows[0]?.status === 'sent') {
        expect(rows[0].locale).toBe('en');
        return;
      }
      await sleep(100);
    }
    throw new Error('notification not marked sent');
  });

  it('drops duplicates by dedupe key', async () => {
    const request = {
      organizationId: null,
      recipient: { type: 'address' as const, destination: `dup-${newId()}@example.test` },
      channel: 'email' as const,
      eventKey: 'auth.password_reset',
      locale: 'en',
      category: 'security' as const,
      values: { firstName: 'Bo', link: 'http://x' },
      dedupeKey: `test__${newId()}`,
    };
    expect((await dispatcher.dispatch(request)).duplicate).toBe(false);
    expect((await dispatcher.dispatch(request)).duplicate).toBe(true);
  });

  it('tenant notifications are isolated', async () => {
    const orgId = newId();
    const { notificationId } = await dispatcher.dispatch({
      organizationId: orgId,
      recipient: { type: 'address', destination: `team-${newId()}@example.test` },
      channel: 'email',
      eventKey: 'team.invitation',
      locale: 'en',
      category: 'transactional',
      values: { inviterName: 'Sam', organizationName: 'Bright Smiles', link: 'http://x' },
    });
    const own = await db.tenantTx(
      { organizationId: orgId, actor: { type: 'system', id: 't' } },
      (tx) => tx.execute(sql`select id from notifications where id = ${notificationId}`),
    );
    const other = await db.tenantTx(
      { organizationId: newId(), actor: { type: 'system', id: 't' } },
      (tx) => tx.execute(sql`select id from notifications where id = ${notificationId}`),
    );
    expect(own.rows).toHaveLength(1);
    expect(other.rows).toHaveLength(0);
  });

  it('fails clearly when no template exists', async () => {
    await expect(
      dispatcher.dispatch({
        organizationId: null,
        recipient: { type: 'address', destination: 'x@example.test' },
        channel: 'email',
        eventKey: 'does.not_exist',
        locale: 'en',
        category: 'security',
        values: {},
      }),
    ).rejects.toThrow(/No email template/);
  });
});
