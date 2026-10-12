import { sql } from 'drizzle-orm';
import { boolean, check, pgPolicy, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core';

import { id, timestamps, version } from '../../../kernel/db/columns';
import { currentOrganizationId } from '../../../kernel/db/rls';

export const NOTIFICATION_CHANNELS = ['sms', 'email', 'whatsapp', 'push', 'in_app'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * `notification_templates` (data model 12): platform defaults (organization_id NULL) and
 * organization/location overrides. Defaults are readable by every tenant; writable only in
 * platform scope.
 */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: id(),
    organizationId: uuid('organization_id'),
    locationId: uuid('location_id'),
    eventKey: text('event_key').notNull(),
    channel: text('channel').$type<NotificationChannel>().notNull(),
    locale: text('locale').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    htmlBody: text('html_body'),
    providerTemplateRef: text('provider_template_ref'),
    isActive: boolean('is_active').notNull().default(true),
    ...version(),
    ...timestamps(),
  },
  (t) => [
    unique('notification_templates_scope_uq')
      .on(t.organizationId, t.locationId, t.eventKey, t.channel, t.locale)
      .nullsNotDistinct(),
    check(
      'notification_templates_channel_ck',
      sql`${t.channel} in ('sms', 'email', 'whatsapp', 'push', 'in_app')`,
    ),
    check(
      'notification_templates_location_ck',
      sql`${t.locationId} is null or ${t.organizationId} is not null`,
    ),
    pgPolicy('tenant_isolation', {
      for: 'all',
      using: sql`organization_id = ${currentOrganizationId}`,
      withCheck: sql`organization_id = ${currentOrganizationId}`,
    }),
    pgPolicy('platform_defaults_read', { for: 'select', using: sql`organization_id is null` }),
    pgPolicy('platform_scope', {
      for: 'all',
      using: sql`current_setting('app.scope', true) = 'platform'`,
      withCheck: sql`current_setting('app.scope', true) = 'platform'`,
    }),
  ],
).enableRLS();
