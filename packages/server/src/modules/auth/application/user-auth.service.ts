import {
  loginSucceeded,
  passwordChanged,
  passwordResetRequested,
  userEmailVerificationRequested,
  userEmailVerified,
  userSignedUp,
} from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../../kernel/context/request-context';
import { Database, type Tx } from '../../../kernel/db/database';
import { AppError, ForbiddenError, UnauthenticatedError } from '../../../kernel/errors/app-error';
import { Clock } from '../../../kernel/time/clock';
import { AuditService } from '../../audit/audit.public';
import { OutboxWriter } from '../../outbox/outbox.public';
import { UsersService, type UserRow } from '../../users/users.public';
import { ChallengeService } from './challenge.service';
import { LoginAttempts } from './login-attempts';
import { MfaLoginTokens } from './mfa-login-tokens';
import { MfaService } from './mfa.service';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy } from './password-policy.service';
import { SessionService, type ActiveSession, type CreatedSession } from './session.service';
import type { AuthSubject } from './subjects';

export type LoginOutcome =
  | { status: 'authenticated'; created: CreatedSession; user: UserRow }
  | { status: 'mfa_required'; mfaToken: string; expiresAt: Date };

const REALM = 'user' as const;

function toSubject(user: UserRow): AuthSubject {
  return {
    id: user.id,
    realm: REALM,
    email: user.email,
    status: user.status,
    sessionVersion: user.sessionVersion,
    mfaRequired: user.mfaRequired,
  };
}

/**
 * Business-user authentication flows (features/auth-and-identity.md, `users` realm):
 * signup, login with optional second factor, password reset/change, email verification.
 * Emails are sent by the worker from the events written here (never inline).
 */
@Injectable()
export class UserAuthService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly challenges: ChallengeService,
    private readonly mfa: MfaService,
    private readonly hasher: PasswordHasher,
    private readonly policy: PasswordPolicy,
    private readonly attempts: LoginAttempts,
    private readonly mfaTokens: MfaLoginTokens,
    private readonly outbox: OutboxWriter,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async signup(input: {
    email: string;
    password: string;
    firstName: string;
    lastName?: string | undefined;
    locale?: string | undefined;
    timezone?: string | undefined;
  }): Promise<{ created: CreatedSession; user: UserRow }> {
    const passwordHash = await this.policy.hashNew(input.password, input.email);
    return this.db.transaction(async (tx) => {
      const user = await this.users.create(tx, { ...input, passwordHash });
      const actor = { type: 'user', id: user.id } as const;
      RequestContext.assign({ actor });
      const created = await this.sessions.create(tx, {
        subject: toSubject(user),
        authMethod: 'password',
        mfaVerified: false,
      });
      await this.users.recordLogin(tx, user.id, this.clock.now());
      await this.outbox.write(tx, userSignedUp, {
        aggregateId: user.id,
        organizationId: null,
        actor,
        data: { userId: user.id },
      });
      await this.audit.record(tx, {
        action: 'user.signed_up',
        actor,
        target: { type: 'user', id: user.id },
      });
      return { created, user };
    });
  }

  async login(email: string, password: string): Promise<LoginOutcome> {
    await this.attempts.assertNotLocked(REALM, email);
    const user = await this.db.transaction((tx) => this.users.findByEmail(tx, email));
    const valid = await this.hasher.verify(user?.passwordHash ?? null, password);
    if (!user || !valid) {
      await this.attempts.recordFailure(REALM, email);
      await this.db.transaction((tx) =>
        this.audit.record(tx, {
          action: 'auth.login_failed',
          actor: { type: 'system', id: 'auth' },
          ...(user ? { target: { type: 'user', id: user.id } } : {}),
          context: { realm: REALM, reason: user ? 'wrong_password' : 'unknown_account' },
        }),
      );
      throw new UnauthenticatedError('invalid_credentials');
    }
    if (user.status !== 'active') throw new ForbiddenError('account_disabled');

    if (user.passwordHash && this.hasher.needsRehash(user.passwordHash)) {
      const rehashed = await this.hasher.hash(password);
      await this.db.transaction((tx) => this.users.setPasswordHash(tx, user.id, rehashed));
    }

    const mfaEnabled = await this.db.transaction((tx) => this.mfa.isEnabled(tx, REALM, user.id));
    if (mfaEnabled) {
      const { token, expiresAt } = await this.mfaTokens.issue({ realm: REALM, subjectId: user.id });
      return { status: 'mfa_required', mfaToken: token, expiresAt };
    }
    await this.attempts.clear(REALM, email);
    return { status: 'authenticated', ...(await this.startSession(user, false)) };
  }

  /** Second step of login: a TOTP code or a recovery code for the pending login token. */
  async completeMfa(
    mfaToken: string,
    proof: { code: string } | { recoveryCode: string },
  ): Promise<{ created: CreatedSession; user: UserRow }> {
    const pending = await this.mfaTokens.peek(mfaToken);
    if (pending?.realm !== REALM) throw new AppError('token_invalid');
    const user = await this.db.transaction((tx) => this.users.findById(tx, pending.subjectId));
    if (!user) throw new AppError('token_invalid');
    await this.attempts.assertNotLocked(REALM, user.email);

    const ok = await this.db.transaction((tx) =>
      'code' in proof
        ? this.mfa.verifyTotp(tx, REALM, user.id, proof.code)
        : this.mfa.useRecoveryCode(tx, REALM, user.id, proof.recoveryCode),
    );
    if (!ok) {
      await this.mfaTokens.recordFailure(mfaToken);
      await this.attempts.recordFailure(REALM, user.email);
      throw new UnauthenticatedError('mfa_code_invalid');
    }
    if (!(await this.mfaTokens.consume(mfaToken))) throw new AppError('token_invalid');
    if (user.status !== 'active') throw new ForbiddenError('account_disabled');
    await this.attempts.clear(REALM, user.email);
    return this.startSession(user, true, 'recoveryCode' in proof);
  }

  async logout(session: ActiveSession): Promise<void> {
    await this.db.transaction((tx) =>
      this.sessions.revokeInTx(
        tx,
        { realm: REALM, subjectId: session.subjectId, sessionId: session.id },
        'logout',
      ),
    );
  }

  async revokeSession(session: ActiveSession, sessionId: string): Promise<void> {
    const revoked = await this.db.transaction((tx) =>
      this.sessions.revokeInTx(
        tx,
        { realm: REALM, subjectId: session.subjectId, sessionId },
        'logout',
      ),
    );
    if (revoked.length === 0) throw new AppError('not_found');
  }

  async revokeOtherSessions(session: ActiveSession): Promise<number> {
    const revoked = await this.db.transaction((tx) =>
      this.sessions.revokeInTx(
        tx,
        { realm: REALM, subjectId: session.subjectId, exceptSessionId: session.id },
        'logout_all',
      ),
    );
    return revoked.length;
  }

  /** Always succeeds from the caller's view; only real, active accounts get an email. */
  async requestPasswordReset(email: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const user = await this.users.findByEmail(tx, email);
      if (user?.status !== 'active') return;
      await this.outbox.write(tx, passwordResetRequested, {
        aggregateId: user.id,
        organizationId: null,
        actor: { type: 'system', id: 'auth' },
        data: { realm: REALM, subjectId: user.id },
      });
    });
  }

  /** Resets the password with a link token and signs out every session. */
  async resetPassword(token: string, password: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const challenge = await this.challenges.consumeLink(tx, {
        realm: REALM,
        purpose: 'password_reset',
        token,
      });
      const user = challenge?.subjectId
        ? await this.users.findById(tx, challenge.subjectId, { forUpdate: true })
        : null;
      if (user?.status !== 'active' || user.email !== challenge?.destination) {
        throw new AppError('token_invalid');
      }
      const actor = { type: 'user', id: user.id } as const;
      const passwordHash = await this.policy.hashNew(password, user.email);
      await this.users.setPasswordHash(tx, user.id, passwordHash);
      // The link proved control of the mailbox.
      await this.users.markEmailVerified(tx, user.id, this.clock.now());
      await this.sessions.revokeInTx(tx, { realm: REALM, subjectId: user.id }, 'password_changed');
      await this.passwordChangedEvent(tx, user.id, 'reset');
      await this.audit.record(tx, {
        action: 'auth.password_reset',
        actor,
        target: { type: 'user', id: user.id },
      });
      await this.attempts.clear(REALM, user.email);
    });
  }

  /** Changes the password after re-checking the current one; other sessions are signed out. */
  async changePassword(
    session: ActiveSession,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.reauthenticate(session, currentPassword);
    const passwordHash = await this.policy.hashNew(newPassword, user.email, 'newPassword');
    await this.db.transaction(async (tx) => {
      await this.users.setPasswordHash(tx, user.id, passwordHash);
      await this.sessions.revokeInTx(
        tx,
        { realm: REALM, subjectId: user.id, exceptSessionId: session.id },
        'password_changed',
      );
      await this.passwordChangedEvent(tx, user.id, 'change');
      await this.audit.record(tx, {
        action: 'auth.password_changed',
        target: { type: 'user', id: user.id },
      });
    });
  }

  async verifyEmail(token: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const challenge = await this.challenges.consumeLink(tx, {
        realm: REALM,
        purpose: 'verify_email',
        token,
      });
      const user = challenge?.subjectId ? await this.users.findById(tx, challenge.subjectId) : null;
      if (!user || user.email !== challenge?.destination) throw new AppError('token_invalid');
      const actor = { type: 'user', id: user.id } as const;
      if (!(await this.users.markEmailVerified(tx, user.id, this.clock.now()))) return;
      await this.outbox.write(tx, userEmailVerified, {
        aggregateId: user.id,
        organizationId: null,
        actor,
        data: { userId: user.id },
      });
      await this.audit.record(tx, {
        action: 'user.email_verified',
        actor,
        target: { type: 'user', id: user.id },
      });
    });
  }

  async resendVerification(session: ActiveSession): Promise<void> {
    await this.db.transaction(async (tx) => {
      const user = await this.users.findById(tx, session.subjectId);
      if (!user || user.emailVerifiedAt) return;
      await this.outbox.write(tx, userEmailVerificationRequested, {
        aggregateId: user.id,
        organizationId: null,
        data: { userId: user.id },
      });
    });
  }

  /** Re-checks the password for a sensitive action (rule 7); counts toward the lockout. */
  async reauthenticate(session: ActiveSession, password: string): Promise<UserRow> {
    const user = await this.db.transaction((tx) => this.users.findById(tx, session.subjectId));
    if (!user) throw new UnauthenticatedError();
    await this.attempts.assertNotLocked(REALM, user.email);
    if (!(await this.hasher.verify(user.passwordHash, password))) {
      await this.attempts.recordFailure(REALM, user.email);
      throw new ForbiddenError('reauthentication_failed');
    }
    return user;
  }

  private async startSession(
    user: UserRow,
    mfaVerified: boolean,
    usedRecoveryCode = false,
  ): Promise<{ created: CreatedSession; user: UserRow }> {
    const actor = { type: 'user', id: user.id } as const;
    RequestContext.assign({ actor });
    const created = await this.db.transaction(async (tx) => {
      const result = await this.sessions.create(tx, {
        subject: toSubject(user),
        authMethod: 'password',
        mfaVerified,
      });
      await this.users.recordLogin(tx, user.id, this.clock.now());
      await this.outbox.write(tx, loginSucceeded, {
        aggregateId: user.id,
        organizationId: null,
        actor,
        data: {
          realm: REALM,
          subjectId: user.id,
          sessionId: result.row.id,
          newDevice: await this.sessions.isNewDevice(tx, result.row),
          deviceLabel: result.row.deviceLabel,
        },
      });
      await this.audit.record(tx, {
        action: 'auth.login_succeeded',
        actor,
        target: { type: 'session', id: result.row.id },
        context: { realm: REALM, mfa: mfaVerified, recoveryCode: usedRecoveryCode },
      });
      return result;
    });
    return { created, user };
  }

  private async passwordChangedEvent(tx: Tx, userId: string, via: 'change' | 'reset') {
    await this.outbox.write(tx, passwordChanged, {
      aggregateId: userId,
      organizationId: null,
      actor: { type: 'user', id: userId },
      data: { realm: REALM, subjectId: userId, via },
    });
  }
}
