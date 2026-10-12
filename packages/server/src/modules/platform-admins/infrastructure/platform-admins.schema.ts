import { ADMIN_ROLES, type AdminRole } from '@attendra/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../../../kernel/db/columns';

export const ADMIN_STATUSES = ['active', 'disabled'] as const;
export type AdminStatus = (typeof ADMIN_STATUSES)[number];

const citext = customType<{ data: string }>({ dataType: () => 'citext' });
const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/** `platform_admins` (data model 01): Attendra staff. Global, never organization members. */
export const platformAdmins = pgTable(
  'platform_admins',
  {
    id: id(),
    email: citext('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').$type<AdminRole>().notNull(),
    status: text('status').$type<AdminStatus>().notNull().default('active'),
    mfaEnforced: boolean('mfa_enforced').notNull().default(true),
    sessionVersion: integer('session_version').notNull().default(1),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('platform_admins_email_uq').on(t.email),
    check('platform_admins_role_ck', sql`${t.role} in (${list(ADMIN_ROLES)})`),
    check('platform_admins_status_ck', sql`${t.status} in (${list(ADMIN_STATUSES)})`),
    check('platform_admins_mfa_ck', sql`${t.mfaEnforced}`),
  ],
);

export type PlatformAdminRow = typeof platformAdmins.$inferSelect;
