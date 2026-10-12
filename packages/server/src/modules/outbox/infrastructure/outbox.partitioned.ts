import { jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { Actor } from '../../../kernel/context/request-context';

/** Correlation stored with each event: request id, W3C traceparent and the actor. */
export interface OutboxTraceContext {
  requestId?: string;
  traceparent?: string;
  actor?: Actor;
}

/**
 * `outbox_events` (data model 14). Partitioned by month: created by hand-written SQL in
 * migrations/0002; this definition is for queries only.
 */
export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  organizationId: uuid('organization_id'),
  locationId: uuid('location_id'),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  eventVersion: smallint('event_version').notNull().default(1),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  traceContext: jsonb('trace_context').$type<OutboxTraceContext>().notNull().default({}),
  publishedAt: timestamp('published_at', { withTimezone: true, mode: 'date' }),
  attempts: smallint('attempts').notNull().default(0),
  lastError: text('last_error'),
});
