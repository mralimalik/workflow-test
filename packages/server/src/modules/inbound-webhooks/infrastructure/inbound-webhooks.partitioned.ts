import { boolean, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const WEBHOOK_PROVIDERS = [
  'stripe',
  'stripe_connect',
  'twilio',
  'google',
  'microsoft',
  'meta',
] as const;
export type WebhookProvider = (typeof WEBHOOK_PROVIDERS)[number];
export type WebhookStatus =
  'received' | 'processing' | 'processed' | 'failed' | 'ignored' | 'rejected';

/** `inbound_webhook_events` (partitioned; created in migrations/0005). Query definition only. */
export const inboundWebhookEvents = pgTable('inbound_webhook_events', {
  id: uuid('id').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  provider: text('provider').$type<WebhookProvider>().notNull(),
  providerEventId: text('provider_event_id').notNull(),
  eventType: text('event_type').notNull(),
  organizationId: uuid('organization_id'),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  signatureValid: boolean('signature_valid').notNull(),
  status: text('status').$type<WebhookStatus>().notNull().default('received'),
  attempts: smallint('attempts').notNull().default(0),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'date' }),
  error: text('error'),
});
