import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../../../kernel/db/columns';

export const FLAG_TYPES = ['boolean', 'string', 'number', 'json'] as const;
export const OVERRIDE_SCOPES = ['plan', 'organization', 'location', 'user'] as const;

/** Global flag definitions (data model 14, FR-ADM-005). Gate rollout of code, not paid features. */
export const featureFlags = pgTable(
  'feature_flags',
  {
    id: id(),
    key: text('key').notNull(),
    description: text('description').notNull(),
    type: text('type').$type<(typeof FLAG_TYPES)[number]>().notNull().default('boolean'),
    defaultValue: jsonb('default_value').notNull(),
    rolloutPercent: smallint('rollout_percent').notNull().default(0),
    isArchived: boolean('is_archived').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('feature_flags_key_uq').on(t.key),
    check('feature_flags_type_ck', sql`${t.type} in ('boolean', 'string', 'number', 'json')`),
    check('feature_flags_rollout_ck', sql`${t.rolloutPercent} between 0 and 100`),
    check('feature_flags_key_ck', sql`${t.key} ~ '^[a-z][a-z0-9_]*(\\.[a-z0-9_]+)+$'`),
  ],
);

export const featureFlagOverrides = pgTable(
  'feature_flag_overrides',
  {
    id: id(),
    featureFlagId: uuid('feature_flag_id')
      .notNull()
      .references(() => featureFlags.id, { onDelete: 'cascade' }),
    scopeType: text('scope_type').$type<(typeof OVERRIDE_SCOPES)[number]>().notNull(),
    scopeId: uuid('scope_id').notNull(),
    value: jsonb('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    setByPlatformAdminId: uuid('set_by_platform_admin_id'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('feature_flag_overrides_flag_scope_uq').on(t.featureFlagId, t.scopeType, t.scopeId),
    check(
      'feature_flag_overrides_scope_ck',
      sql`${t.scopeType} in ('plan', 'organization', 'location', 'user')`,
    ),
  ],
);
