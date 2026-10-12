import { inet, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `audit_logs` (data model 14). Partitioned by month: created by hand-written SQL in
 * migrations/0002; this definition is for queries only and is outside drizzle-kit's glob.
 */
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  organizationId: uuid('organization_id'),
  locationId: uuid('location_id'),
  actorType: text('actor_type').notNull(),
  actorId: uuid('actor_id'),
  impersonationSessionId: uuid('impersonation_session_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: uuid('target_id'),
  changes: jsonb('changes').$type<Record<string, [unknown, unknown]>>().notNull().default({}),
  context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
  requestId: text('request_id'),
  ip: inet('ip'),
  userAgent: text('user_agent'),
});

export type AuditLogRow = typeof auditLogs.$inferSelect;
