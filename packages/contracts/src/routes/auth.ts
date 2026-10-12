import { z } from 'zod';

import type { ErrorCode } from '../errors';
import { emailSchema, localeSchema, timestampSchema, timezoneSchema } from '../common/primitives';
import { ADMIN_ROLES, defineRoute, type Realm } from '../http/route';

/** Password policy (features/auth-and-identity.md rule 2); breach check runs server-side. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 256;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .meta({ id: 'Password', format: 'password' });

/** The signed-in business user, as returned by session and account endpoints. */
export const currentUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    emailVerified: z.boolean(),
    firstName: z.string(),
    lastName: z.string().nullable(),
    phoneE164: z.string().nullable(),
    locale: z.string(),
    timezone: z.string().nullable(),
    avatar: z
      .object({ fileId: z.uuid(), url: z.url(), expiresAt: timestampSchema })
      .nullable()
      .meta({ description: 'Short-lived download URL; refetch the account when it expires' }),
    mfaEnabled: z.boolean(),
    createdAt: timestampSchema,
  })
  .meta({ id: 'CurrentUser' });

/** The signed-in platform admin. */
export const currentAdminSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: z.enum(ADMIN_ROLES),
    mfaEnabled: z.boolean(),
    createdAt: timestampSchema,
  })
  .meta({ id: 'CurrentAdmin' });

export const AUTH_METHODS = [
  'password',
  'otp_sms',
  'otp_email',
  'otp_whatsapp',
  'magic_link',
  'oauth_google',
  'refresh',
] as const;

export const sessionInfoSchema = z
  .object({
    id: z.uuid(),
    authMethod: z.enum(AUTH_METHODS),
    mfaVerified: z.boolean(),
    createdAt: timestampSchema,
    idleExpiresAt: timestampSchema,
    absoluteExpiresAt: timestampSchema,
  })
  .meta({ id: 'SessionInfo' });

const csrfToken = z.string().meta({
  description: 'Send as `X-CSRF-Token` on every state-changing request of this session',
});

/** What a signed-in web client bootstraps from (`GET /session`, login, signup). */
export const userSessionSchema = z
  .object({
    user: currentUserSchema,
    session: sessionInfoSchema,
    csrfToken,
    mfaEnrollmentRequired: z.boolean().meta({
      description: 'An organization requires 2FA: business endpoints refuse until TOTP is set up',
    }),
  })
  .meta({ id: 'UserSession' });

export const adminSessionSchema = z
  .object({
    admin: currentAdminSchema,
    session: sessionInfoSchema,
    csrfToken,
    mfaEnrollmentRequired: z.boolean().meta({
      description: 'Admins must use TOTP: admin endpoints refuse until it is set up',
    }),
  })
  .meta({ id: 'AdminSession' });

const mfaRequiredSchema = z.object({
  status: z.literal('mfa_required'),
  mfaToken: z.string().meta({ description: 'Single-use; pass to `mfa/verify` within 5 minutes' }),
  methods: z.array(z.enum(['totp', 'recovery_code'])),
  expiresAt: timestampSchema,
});

export const loginResultSchema = z
  .discriminatedUnion('status', [
    userSessionSchema.extend({ status: z.literal('authenticated') }),
    mfaRequiredSchema,
  ])
  .meta({ id: 'LoginResult' });

export const adminLoginResultSchema = z
  .discriminatedUnion('status', [
    adminSessionSchema.extend({ status: z.literal('authenticated') }),
    mfaRequiredSchema,
  ])
  .meta({ id: 'AdminLoginResult' });

export const sessionListItemSchema = z
  .object({
    id: z.uuid(),
    current: z.boolean(),
    authMethod: z.enum(AUTH_METHODS),
    deviceLabel: z.string().nullable(),
    ip: z.string().nullable(),
    createdAt: timestampSchema,
    lastSeenAt: timestampSchema,
  })
  .meta({ id: 'SessionListItem' });

export const totpEnrollmentSchema = z
  .object({ secret: z.string(), otpauthUrl: z.string(), expiresAt: timestampSchema })
  .meta({ id: 'TotpEnrollment' });

const sixDigits = z.string().regex(/^\d{6}$/, 'Expected a 6-digit code');
const linkToken = z.string().min(20).max(200);
const sessionErrors = ['unauthenticated', 'session_expired'] as const satisfies ErrorCode[];
const writeErrors = [...sessionErrors, 'csrf_token_invalid'] as const satisfies ErrorCode[];

/**
 * Endpoints every password realm shares (features/auth-and-identity.md API table), under
 * `/v1/auth/{segment}`. Each realm has its own cookie, sessions and route ids.
 */
function passwordRealmRoutes<
  const S extends 'users' | 'admins',
  const R extends Realm,
  SS extends z.ZodType,
  LS extends z.ZodType,
>(config: { segment: S; realm: R; tag: string; session: SS; loginResult: LS }) {
  const { segment, realm, tag } = config;
  const prefix = `/v1/auth/${segment}` as const;
  const tags = [tag];
  return {
    login: defineRoute({
      id: `auth.${segment}.login`,
      method: 'POST',
      path: `${prefix}/login`,
      audience: 'auth',
      auth: 'none',
      rateLimit: 'auth.login',
      summary: 'Sign in with email and password',
      description:
        'Returns a session, or `mfa_required` with a single-use token when two-factor authentication is on.',
      tags,
      request: { body: z.object({ email: emailSchema, password: z.string().min(1).max(256) }) },
      responses: {
        200: { description: 'Signed in, or second factor needed', schema: config.loginResult },
      },
      errors: ['invalid_credentials', 'account_disabled', 'rate_limited'],
    }),
    mfaVerify: defineRoute({
      id: `auth.${segment}.mfa.verify`,
      method: 'POST',
      path: `${prefix}/mfa/verify`,
      audience: 'auth',
      auth: 'none',
      rateLimit: 'auth.login',
      summary: 'Complete sign-in with a TOTP or recovery code',
      tags,
      request: {
        body: z.union([
          z.object({ mfaToken: z.string().min(20).max(200), code: sixDigits }),
          z.object({
            mfaToken: z.string().min(20).max(200),
            recoveryCode: z.string().trim().min(8).max(32),
          }),
        ]),
      },
      responses: { 200: { description: 'Signed in', schema: config.session } },
      errors: ['mfa_code_invalid', 'token_invalid', 'account_disabled', 'rate_limited'],
    }),
    session: defineRoute({
      id: `auth.${segment}.session`,
      method: 'GET',
      path: `${prefix}/session`,
      audience: 'auth',
      auth: realm,
      summary: 'Current subject, session and CSRF token',
      tags,
      responses: { 200: { description: 'The current session', schema: config.session } },
      errors: [...sessionErrors],
    }),
    logout: defineRoute({
      id: `auth.${segment}.logout`,
      method: 'POST',
      path: `${prefix}/logout`,
      audience: 'auth',
      auth: realm,
      summary: 'Sign out (revoke the current session)',
      tags,
      responses: { 204: { description: 'Signed out' } },
      errors: [...writeErrors],
    }),
    listSessions: defineRoute({
      id: `auth.${segment}.sessions.list`,
      method: 'GET',
      path: `${prefix}/sessions`,
      audience: 'auth',
      auth: realm,
      summary: 'List active sessions (devices)',
      tags,
      responses: {
        200: {
          description: 'Active sessions, most recent first',
          schema: z.object({ data: z.array(sessionListItemSchema) }),
        },
      },
      errors: [...sessionErrors],
    }),
    revokeSession: defineRoute({
      id: `auth.${segment}.sessions.revoke`,
      method: 'DELETE',
      path: `${prefix}/sessions/{sessionId}`,
      audience: 'auth',
      auth: realm,
      summary: 'Sign out one session',
      tags,
      request: { params: z.object({ sessionId: z.uuid() }) },
      responses: { 204: { description: 'Revoked' } },
      errors: [...writeErrors, 'not_found'],
    }),
    revokeOtherSessions: defineRoute({
      id: `auth.${segment}.sessions.revoke_others`,
      method: 'POST',
      path: `${prefix}/sessions/revoke-others`,
      audience: 'auth',
      auth: realm,
      summary: 'Sign out every other session',
      tags,
      responses: {
        200: { description: 'Revoked', schema: z.object({ revoked: z.int().nonnegative() }) },
      },
      errors: [...writeErrors],
    }),
    forgotPassword: defineRoute({
      id: `auth.${segment}.password.forgot`,
      method: 'POST',
      path: `${prefix}/password/forgot`,
      audience: 'auth',
      auth: 'none',
      rateLimit: 'auth.link',
      summary: 'Email a password reset link',
      description: 'Always accepted, whether or not the account exists (no account enumeration).',
      tags,
      request: { body: z.object({ email: emailSchema }) },
      responses: { 202: { description: 'If the account exists, a link was sent' } },
      errors: ['rate_limited'],
    }),
    resetPassword: defineRoute({
      id: `auth.${segment}.password.reset`,
      method: 'POST',
      path: `${prefix}/password/reset`,
      audience: 'auth',
      auth: 'none',
      rateLimit: 'auth.link',
      summary: 'Set a new password with a reset link token',
      description: 'Single use. Signs out every session of the account.',
      tags,
      request: { body: z.object({ token: linkToken, password: passwordSchema }) },
      responses: { 204: { description: 'Password changed' } },
      errors: ['token_invalid', 'rate_limited'],
    }),
    changePassword: defineRoute({
      id: `auth.${segment}.password.change`,
      method: 'POST',
      path: `${prefix}/password/change`,
      audience: 'auth',
      auth: realm,
      rateLimit: 'auth.login',
      summary: 'Change password (requires the current one)',
      description: 'Signs out every other session.',
      tags,
      request: {
        body: z.object({
          currentPassword: z.string().min(1).max(256),
          newPassword: passwordSchema,
        }),
      },
      responses: { 204: { description: 'Password changed' } },
      errors: [...writeErrors, 'reauthentication_failed', 'rate_limited'],
    }),
    totpEnroll: defineRoute({
      id: `auth.${segment}.mfa.totp.enroll`,
      method: 'POST',
      path: `${prefix}/mfa/totp/enroll`,
      audience: 'auth',
      auth: realm,
      rateLimit: 'auth.login',
      summary: 'Start TOTP setup (requires the password)',
      description: 'Returns a new secret to add to an authenticator app; confirm it with a code.',
      tags,
      request: { body: z.object({ password: z.string().min(1).max(256) }) },
      responses: {
        200: {
          description: 'Pending factor',
          schema: totpEnrollmentSchema,
        },
      },
      errors: [...writeErrors, 'reauthentication_failed', 'mfa_already_enabled', 'rate_limited'],
    }),
    totpConfirm: defineRoute({
      id: `auth.${segment}.mfa.totp.confirm`,
      method: 'POST',
      path: `${prefix}/mfa/totp/confirm`,
      audience: 'auth',
      auth: realm,
      rateLimit: 'auth.login',
      summary: 'Activate TOTP with a code from the app',
      description: 'Returns 10 single-use recovery codes. They are shown only once.',
      tags,
      request: { body: z.object({ code: sixDigits }) },
      responses: {
        200: {
          description: 'Two-factor authentication is on',
          schema: z.object({ recoveryCodes: z.array(z.string()).length(10) }),
        },
      },
      errors: [
        ...writeErrors,
        'mfa_code_invalid',
        'mfa_already_enabled',
        'token_invalid',
        'rate_limited',
      ],
    }),
  };
}

/**
 * Business-user authentication (features/auth-and-identity.md, `users` realm). Cookie
 * `att_u`; state-changing calls of a signed-in session need `X-CSRF-Token`.
 */
export const userAuthRoutes = {
  ...passwordRealmRoutes({
    segment: 'users',
    realm: 'user',
    tag: 'Auth · users',
    session: userSessionSchema,
    loginResult: loginResultSchema,
  }),
  signup: defineRoute({
    id: 'auth.users.signup',
    method: 'POST',
    path: '/v1/auth/users/signup',
    audience: 'auth',
    auth: 'none',
    rateLimit: 'auth.link',
    summary: 'Create a user account and sign in',
    description:
      'Creates the user with an unverified email, sends the verification link and starts a session (FR-AUTH-001).',
    tags: ['Auth · users'],
    request: {
      body: z.object({
        email: emailSchema,
        password: passwordSchema,
        firstName: z.string().trim().min(1).max(100),
        lastName: z.string().trim().min(1).max(100).optional(),
        locale: localeSchema.optional(),
        timezone: timezoneSchema.optional(),
      }),
    },
    responses: { 201: { description: 'Signed up and signed in', schema: userSessionSchema } },
    errors: ['email_taken', 'rate_limited'],
  }),
  verifyEmail: defineRoute({
    id: 'auth.users.email.verify',
    method: 'POST',
    path: '/v1/auth/users/email/verify',
    audience: 'auth',
    auth: 'none',
    rateLimit: 'auth.link',
    summary: 'Confirm the email address with the link token',
    tags: ['Auth · users'],
    request: { body: z.object({ token: linkToken }) },
    responses: { 204: { description: 'Email verified' } },
    errors: ['token_invalid', 'rate_limited'],
  }),
  resendVerification: defineRoute({
    id: 'auth.users.email.resend',
    method: 'POST',
    path: '/v1/auth/users/email/resend',
    audience: 'auth',
    auth: 'user',
    rateLimit: 'auth.link',
    summary: 'Send the verification link again',
    tags: ['Auth · users'],
    responses: { 202: { description: 'Sent (no-op when already verified)' } },
    errors: [...writeErrors, 'rate_limited'],
  }),
  totpDisable: defineRoute({
    id: 'auth.users.mfa.totp.disable',
    method: 'POST',
    path: '/v1/auth/users/mfa/totp/disable',
    audience: 'auth',
    auth: 'user',
    rateLimit: 'auth.login',
    summary: 'Turn off TOTP (requires the password)',
    description: 'Refused while an organization the user belongs to requires 2FA.',
    tags: ['Auth · users'],
    request: { body: z.object({ password: z.string().min(1).max(256) }) },
    responses: { 204: { description: 'Two-factor authentication is off' } },
    errors: [
      ...writeErrors,
      'reauthentication_failed',
      'mfa_not_enabled',
      'forbidden',
      'rate_limited',
    ],
  }),
};

/**
 * Platform admin authentication (`admins` path segment, `platform_admin` realm, cookie
 * `att_a`). TOTP is mandatory: until it is set up, admin endpoints refuse the session.
 * There is no signup; admins are created by the CLI or by a super admin.
 */
export const adminAuthRoutes = passwordRealmRoutes({
  segment: 'admins',
  realm: 'platform_admin',
  tag: 'Auth · admins',
  session: adminSessionSchema,
  loginResult: adminLoginResultSchema,
});

export type CurrentUser = z.infer<typeof currentUserSchema>;
export type CurrentAdmin = z.infer<typeof currentAdminSchema>;
export type UserSession = z.infer<typeof userSessionSchema>;
export type AdminSession = z.infer<typeof adminSessionSchema>;
