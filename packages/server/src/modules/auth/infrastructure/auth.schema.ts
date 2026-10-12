import { REALMS } from '@attendra/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, createdAt, id, timestamps } from '../../../kernel/db/columns';

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));
const tz = { withTimezone: true, mode: 'date' } as const;

export const CLIENT_TYPES = ['web', 'mobile', 'cli'] as const;
export const SESSION_AUTH_METHODS = [
  'password',
  'otp_sms',
  'otp_email',
  'otp_whatsapp',
  'magic_link',
  'oauth_google',
  'refresh',
] as const;
export const REVOKE_REASONS = [
  'logout',
  'logout_all',
  'password_changed',
  'banned',
  'admin',
  'expired',
  'reuse_detected',
] as const;
export type RevokeReason = (typeof REVOKE_REASONS)[number];

/**
 * `sessions` (data model 01): one row per login, any realm. The cookie holds the raw id; only
 * its SHA-256 is stored. Identity tables are global (no `organization_id`, no RLS).
 */
export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tokenHash: bytea('token_hash').notNull(),
    subjectType: text('subject_type').$type<(typeof REALMS)[number]>().notNull(),
    subjectId: uuid('subject_id').notNull(),
    clientType: text('client_type').$type<(typeof CLIENT_TYPES)[number]>().notNull(),
    authMethod: text('auth_method').$type<(typeof SESSION_AUTH_METHODS)[number]>().notNull(),
    mfaVerifiedAt: timestamp('mfa_verified_at', tz),
    csrfSecret: bytea('csrf_secret'),
    subjectVersion: integer('subject_version').notNull(),
    ip: inet('ip'),
    userAgent: text('user_agent'),
    deviceLabel: text('device_label'),
    impersonationSessionId: uuid('impersonation_session_id'),
    lastSeenAt: timestamp('last_seen_at', tz).notNull().defaultNow(),
    idleExpiresAt: timestamp('idle_expires_at', tz).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', tz).notNull(),
    revokedAt: timestamp('revoked_at', tz),
    revokeReason: text('revoke_reason').$type<RevokeReason>(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_uq').on(t.tokenHash),
    index('sessions_subject_active_idx')
      .on(t.subjectType, t.subjectId)
      .where(sql`${t.revokedAt} is null`),
    index('sessions_absolute_expires_idx').on(t.absoluteExpiresAt),
    check('sessions_subject_type_ck', sql`${t.subjectType} in (${list(REALMS)})`),
    check('sessions_client_type_ck', sql`${t.clientType} in (${list(CLIENT_TYPES)})`),
    check('sessions_auth_method_ck', sql`${t.authMethod} in (${list(SESSION_AUTH_METHODS)})`),
    check(
      'sessions_revoke_reason_ck',
      sql`${t.revokeReason} is null or ${t.revokeReason} in (${list(REVOKE_REASONS)})`,
    ),
    check('sessions_revoked_ck', sql`(${t.revokedAt} is null) = (${t.revokeReason} is null)`),
    check('sessions_expiry_ck', sql`${t.idleExpiresAt} <= ${t.absoluteExpiresAt}`),
  ],
);

export const CHALLENGE_KINDS = ['otp', 'link'] as const;
export const CHALLENGE_PURPOSES = [
  'login',
  'verify_phone',
  'verify_email',
  'password_reset',
  'change_email',
  'change_phone',
  'widget_identify',
  'mfa_recovery',
] as const;
export type ChallengePurpose = (typeof CHALLENGE_PURPOSES)[number];
export const CHALLENGE_CHANNELS = ['sms', 'whatsapp', 'email', 'voice'] as const;

/**
 * `auth_challenges` (data model 01): every one-time secret. Only the peppered HMAC of the
 * code or link token is stored; consumption is a single conditional UPDATE.
 */
export const authChallenges = pgTable(
  'auth_challenges',
  {
    id: id(),
    kind: text('kind').$type<(typeof CHALLENGE_KINDS)[number]>().notNull(),
    purpose: text('purpose').$type<ChallengePurpose>().notNull(),
    realm: text('realm').$type<(typeof REALMS)[number]>().notNull(),
    subjectId: uuid('subject_id'),
    channel: text('channel').$type<(typeof CHALLENGE_CHANNELS)[number]>().notNull(),
    destination: text('destination').notNull(),
    secretHash: bytea('secret_hash').notNull(),
    attempts: smallint('attempts').notNull().default(0),
    maxAttempts: smallint('max_attempts').notNull().default(5),
    expiresAt: timestamp('expires_at', tz).notNull(),
    consumedAt: timestamp('consumed_at', tz),
    contextOrganizationId: uuid('context_organization_id'),
    ip: inet('ip'),
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    ...createdAt(),
    updatedAt: timestamp('updated_at', tz)
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Link tokens are looked up by hash; OTPs are found by id and then compared.
    uniqueIndex('auth_challenges_secret_hash_uq')
      .on(t.secretHash)
      .where(sql`${t.kind} = 'link'`),
    index('auth_challenges_destination_idx').on(t.destination, t.purpose, t.createdAt.desc()),
    index('auth_challenges_subject_idx').on(t.realm, t.subjectId, t.purpose),
    index('auth_challenges_expires_idx').on(t.expiresAt),
    check('auth_challenges_kind_ck', sql`${t.kind} in (${list(CHALLENGE_KINDS)})`),
    check('auth_challenges_purpose_ck', sql`${t.purpose} in (${list(CHALLENGE_PURPOSES)})`),
    check('auth_challenges_realm_ck', sql`${t.realm} in (${list(REALMS)})`),
    check('auth_challenges_channel_ck', sql`${t.channel} in (${list(CHALLENGE_CHANNELS)})`),
    check('auth_challenges_attempts_ck', sql`${t.attempts} >= 0 and ${t.maxAttempts} > 0`),
  ],
);

export const MFA_FACTOR_TYPES = ['totp', 'recovery_codes'] as const;

/**
 * `mfa_factors` (data model 01): TOTP secrets (envelope-encrypted) and hashed recovery codes.
 * A factor is active only once verified; one active TOTP per subject.
 */
export const mfaFactors = pgTable(
  'mfa_factors',
  {
    id: id(),
    subjectType: text('subject_type').$type<'platform_admin' | 'user'>().notNull(),
    subjectId: uuid('subject_id').notNull(),
    type: text('type').$type<(typeof MFA_FACTOR_TYPES)[number]>().notNull(),
    secretCiphertext: bytea('secret_ciphertext').notNull(),
    label: text('label'),
    verifiedAt: timestamp('verified_at', tz),
    lastUsedAt: timestamp('last_used_at', tz),
    lastUsedStep: bigint('last_used_step', { mode: 'number' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('mfa_factors_active_uq')
      .on(t.subjectType, t.subjectId, t.type)
      .where(sql`${t.verifiedAt} is not null`),
    index('mfa_factors_subject_idx').on(t.subjectType, t.subjectId),
    check('mfa_factors_subject_type_ck', sql`${t.subjectType} in ('platform_admin', 'user')`),
    check('mfa_factors_type_ck', sql`${t.type} in (${list(MFA_FACTOR_TYPES)})`),
  ],
);

export type SessionRow = typeof sessions.$inferSelect;
export type ChallengeRow = typeof authChallenges.$inferSelect;
export type MfaFactorRow = typeof mfaFactors.$inferSelect;
