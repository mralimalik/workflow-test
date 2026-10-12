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
  uuid,
} from 'drizzle-orm/pg-core';

import { id, timestamps } from '../../../kernel/db/columns';
import { fileIdColumn } from '../../files/files.public';

export const USER_STATUSES = ['active', 'disabled', 'banned'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Case-insensitive text (`citext` extension, created by the baseline migration). */
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * `users` (data model 01): business-side people. Global (not tenant-scoped): one user may
 * belong to many organizations through memberships, so no RLS.
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    email: citext('email').notNull(),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
    phoneE164: text('phone_e164'),
    passwordHash: text('password_hash'),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    avatarFileId: uuid('avatar_file_id').references(fileIdColumn, { onDelete: 'set null' }),
    locale: text('locale').notNull().default('en'),
    timezone: text('timezone'),
    status: text('status').$type<UserStatus>().notNull().default('active'),
    bannedAt: timestamp('banned_at', { withTimezone: true, mode: 'date' }),
    banReason: text('ban_reason'),
    sessionVersion: integer('session_version').notNull().default(1),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true, mode: 'date' }),
    mfaRequired: boolean('mfa_required').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    check('users_status_ck', sql`${t.status} in ('active', 'disabled', 'banned')`),
    check('users_phone_ck', sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check('users_session_version_ck', sql`${t.sessionVersion} >= 1`),
  ],
);

export type UserRow = typeof users.$inferSelect;
