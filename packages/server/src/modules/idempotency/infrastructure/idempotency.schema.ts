import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, id, timestamps } from '../../../kernel/db/columns';

/** Stored responses for idempotent POSTs (data model 14 §idempotency_keys, BACKEND.md §5.9). */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: bytea('request_hash').notNull(),
    status: text('status', { enum: ['in_progress', 'completed'] })
      .notNull()
      .default('in_progress'),
    responseStatus: smallint('response_status'),
    responseBody: jsonb('response_body'),
    resourceType: text('resource_type'),
    resourceId: uuid('resource_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('idempotency_keys_scope_key_uq').on(t.scope, t.key),
    index('idempotency_keys_expires_at_idx').on(t.expiresAt),
    check('idempotency_keys_status_ck', sql`${t.status} in ('in_progress', 'completed')`),
  ],
);

export type IdempotencyKeyRow = typeof idempotencyKeys.$inferSelect;
