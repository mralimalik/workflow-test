import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import type { NotificationChannel } from './notification-templates.schema';

export type NotificationCategory = 'transactional' | 'marketing' | 'security' | 'staff_alert';
export type NotificationStatus =
  | 'queued'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'bounced'
  | 'suppressed'
  | 'canceled';

/** `notifications` (partitioned; migrations/0007). Query definition only. */
export const notifications = pgTable('notifications', {
  id: uuid('id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  organizationId: uuid('organization_id'),
  locationId: uuid('location_id'),
  recipientType: text('recipient_type').$type<'customer' | 'user' | 'address'>().notNull(),
  recipientId: uuid('recipient_id'),
  channel: text('channel').$type<NotificationChannel>().notNull(),
  destination: text('destination').notNull(),
  eventKey: text('event_key').notNull(),
  templateId: uuid('template_id'),
  locale: text('locale').notNull(),
  category: text('category').$type<NotificationCategory>().notNull(),
  relatedType: text('related_type'),
  relatedId: uuid('related_id'),
  rendered: jsonb('rendered')
    .$type<{ subject: string | null; body: string; html: string | null }>()
    .notNull(),
  status: text('status').$type<NotificationStatus>().notNull().default('queued'),
  suppressionReason: text('suppression_reason'),
  provider: text('provider'),
  providerMessageId: text('provider_message_id'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }),
  dedupeKey: text('dedupe_key'),
});
