import { Injectable } from '@nestjs/common';
import type { EventDefinition } from '@attendra/contracts';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';

import { RequestContext, type Actor } from '../../../kernel/context/request-context';
import type { Tx } from '../../../kernel/db/database';
import { newId } from '../../../kernel/ids/ids';
import { currentTraceContext } from '../../../kernel/queue/trace';
import { outboxEvents } from '../infrastructure/outbox.partitioned';

export const OUTBOX_CHANNEL = 'outbox_events';

export interface OutboxEventInput<S extends z.ZodType> {
  aggregateId: string;
  organizationId: string | null;
  locationId?: string | null;
  data: z.input<S>;
  /** Defaults to the request's actor (or `system`). */
  actor?: Actor;
}

/**
 * Writes domain events in the producer's transaction (transactional outbox, BACKEND.md
 * §10.1): an event exists if and only if the change committed. The NOTIFY is delivered by
 * Postgres on commit and wakes the relay.
 */
@Injectable()
export class OutboxWriter {
  async write<S extends z.ZodType>(
    tx: Tx,
    event: EventDefinition<string, S>,
    input: OutboxEventInput<S>,
  ): Promise<string> {
    const data = event.data.parse(input.data) as Record<string, unknown>;
    const actor = input.actor ?? RequestContext.get()?.actor ?? { type: 'system', id: 'system' };
    const id = newId();
    await tx.insert(outboxEvents).values({
      id,
      organizationId: input.organizationId,
      locationId: input.locationId ?? null,
      aggregateType: event.aggregate,
      aggregateId: input.aggregateId,
      eventType: event.type,
      eventVersion: event.version,
      payload: data,
      traceContext: { ...currentTraceContext(), actor },
    });
    await tx.execute(sql`select pg_notify(${OUTBOX_CHANNEL}, '')`);
    return id;
  }
}
