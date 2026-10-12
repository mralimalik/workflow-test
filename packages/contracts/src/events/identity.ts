import { z } from 'zod';

import { REALMS } from '../http/route';
import { defineEvent } from './event';

/** Identity and authentication events (features/auth-and-identity.md "Events and jobs"). */
const subject = { realm: z.enum(REALMS), subjectId: z.uuid() };

export const userSignedUp = defineEvent({
  type: 'user.signed_up',
  version: 1,
  aggregate: 'user',
  data: z.object({ userId: z.uuid() }),
});

export const userEmailVerificationRequested = defineEvent({
  type: 'user.email_verification_requested',
  version: 1,
  aggregate: 'user',
  data: z.object({ userId: z.uuid() }),
});

export const userEmailVerified = defineEvent({
  type: 'user.email_verified',
  version: 1,
  aggregate: 'user',
  data: z.object({ userId: z.uuid() }),
});

export const passwordResetRequested = defineEvent({
  type: 'auth.password_reset_requested',
  version: 1,
  aggregate: 'auth_subject',
  data: z.object(subject),
});

export const passwordChanged = defineEvent({
  type: 'auth.password_changed',
  version: 1,
  aggregate: 'auth_subject',
  data: z.object({ ...subject, via: z.enum(['change', 'reset']) }),
});

export const loginSucceeded = defineEvent({
  type: 'auth.login_succeeded',
  version: 1,
  aggregate: 'auth_subject',
  data: z.object({
    ...subject,
    sessionId: z.uuid(),
    /** No earlier session of this subject came from the same device label. */
    newDevice: z.boolean(),
    deviceLabel: z.string().nullable(),
  }),
});

export const sessionRevoked = defineEvent({
  type: 'session.revoked',
  version: 1,
  aggregate: 'session',
  data: z.object({
    ...subject,
    sessionIds: z.array(z.uuid()),
    reason: z.enum([
      'logout',
      'logout_all',
      'password_changed',
      'banned',
      'admin',
      'expired',
      'reuse_detected',
    ]),
  }),
});

export const mfaChanged = defineEvent({
  type: 'auth.mfa_changed',
  version: 1,
  aggregate: 'auth_subject',
  data: z.object({ ...subject, enabled: z.boolean() }),
});

export const subjectBanned = defineEvent({
  type: 'subject.banned',
  version: 1,
  aggregate: 'auth_subject',
  data: z.object({ ...subject, reason: z.string() }),
});

export const subjectUnbanned = defineEvent({
  type: 'subject.unbanned',
  version: 1,
  aggregate: 'auth_subject',
  data: z.object(subject),
});

/** A platform admin was created and must set a password (invitation email). */
export const platformAdminInvited = defineEvent({
  type: 'platform_admin.invited',
  version: 1,
  aggregate: 'platform_admin',
  data: z.object({ adminId: z.uuid() }),
});
