import { loginSucceeded, passwordChanged, passwordResetRequested } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import { RequestContext, type Actor } from '../../../kernel/context/request-context';
import { Database, type Tx } from '../../../kernel/db/database';
import { AppError, ForbiddenError, UnauthenticatedError } from '../../../kernel/errors/app-error';
import { Clock } from '../../../kernel/time/clock';
import { AuditService } from '../../audit/audit.public';
import { OutboxWriter } from '../../outbox/outbox.public';
import { ChallengeService } from './challenge.service';
import { LoginAttempts } from './login-attempts';
import { MfaLoginTokens } from './mfa-login-tokens';
import { MfaService } from './mfa.service';
import { PasswordHasher } from './password-hasher';
import { PasswordPolicy } from './password-policy.service';
import { SessionService, type ActiveSession, type CreatedSession } from './session.service';
import { Subjects, type PasswordAccount, type PasswordRealm } from './subjects';

export interface SignedIn {
  created: CreatedSession;
  account: PasswordAccount;
}

export type LoginOutcome =
  | ({ status: 'authenticated' } & SignedIn)
  | { status: 'mfa_required'; mfaToken: string; expiresAt: Date };

const actorOf = (account: Pick<PasswordAccount, 'realm' | 'id'>): Actor =>
  account.realm === 'user'
    ? { type: 'user', id: account.id }
    : { type: 'platform_admin', id: account.id };

/** Audit target type per realm. */
const targetType = (realm: PasswordRealm) => (realm === 'user' ? 'user' : 'platform_admin');

/**
 * Password-realm flows shared by business users and platform admins
 * (features/auth-and-identity.md): login with a second factor, sessions, password reset and
 * change. Emails are sent by the worker from the events written here (never inline).
 */
@Injectable()
export class PasswordAuthService {
  constructor(
    private readonly db: Database,
    private readonly subjects: Subjects,
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

  async login(realm: PasswordRealm, email: string, password: string): Promise<LoginOutcome> {
    await this.attempts.assertNotLocked(realm, email);
    const account = await this.db.transaction((tx) =>
      this.subjects.findAccountByEmail(tx, realm, email),
    );
    const valid = await this.hasher.verify(account?.passwordHash ?? null, password);
    if (!account || !valid) {
      await this.attempts.recordFailure(realm, email);
      await this.db.transaction((tx) =>
        this.audit.record(tx, {
          action: 'auth.login_failed',
          actor: { type: 'system', id: 'auth' },
          ...(account ? { target: { type: targetType(realm), id: account.id } } : {}),
          context: { realm, reason: account ? 'wrong_password' : 'unknown_account' },
        }),
      );
      throw new UnauthenticatedError('invalid_credentials');
    }
    if (account.status !== 'active') throw new ForbiddenError('account_disabled');

    if (account.passwordHash && this.hasher.needsRehash(account.passwordHash)) {
      const rehashed = await this.hasher.hash(password);
      await this.db.transaction((tx) =>
        this.subjects.setPasswordHash(tx, realm, account.id, rehashed),
      );
    }

    const mfaEnabled = await this.db.transaction((tx) => this.mfa.isEnabled(tx, realm, account.id));
    if (mfaEnabled) {
      const { token, expiresAt } = await this.mfaTokens.issue({ realm, subjectId: account.id });
      return { status: 'mfa_required', mfaToken: token, expiresAt };
    }
    await this.attempts.clear(realm, email);
    return { status: 'authenticated', ...(await this.startSession(account, false)) };
  }

  /** Second step of login: a TOTP code or a recovery code for the pending login token. */
  async completeMfa(
    realm: PasswordRealm,
    mfaToken: string,
    proof: { code: string } | { recoveryCode: string },
  ): Promise<SignedIn> {
    const pending = await this.mfaTokens.peek(mfaToken);
    if (pending?.realm !== realm) throw new AppError('token_invalid');
    const account = await this.db.transaction((tx) =>
      this.subjects.findAccount(tx, realm, pending.subjectId),
    );
    if (!account) throw new AppError('token_invalid');
    await this.attempts.assertNotLocked(realm, account.email);

    const ok = await this.db.transaction((tx) =>
      'code' in proof
        ? this.mfa.verifyTotp(tx, realm, account.id, proof.code)
        : this.mfa.useRecoveryCode(tx, realm, account.id, proof.recoveryCode),
    );
    if (!ok) {
      await this.mfaTokens.recordFailure(mfaToken);
      await this.attempts.recordFailure(realm, account.email);
      throw new UnauthenticatedError('mfa_code_invalid');
    }
    if (!(await this.mfaTokens.consume(mfaToken))) throw new AppError('token_invalid');
    if (account.status !== 'active') throw new ForbiddenError('account_disabled');
    await this.attempts.clear(realm, account.email);
    return this.startSession(account, true, 'recoveryCode' in proof);
  }

  async logout(session: ActiveSession): Promise<void> {
    await this.db.transaction((tx) =>
      this.sessions.revokeInTx(
        tx,
        { realm: session.realm, subjectId: session.subjectId, sessionId: session.id },
        'logout',
      ),
    );
  }

  async revokeSession(session: ActiveSession, sessionId: string): Promise<void> {
    const revoked = await this.db.transaction((tx) =>
      this.sessions.revokeInTx(
        tx,
        { realm: session.realm, subjectId: session.subjectId, sessionId },
        'logout',
      ),
    );
    if (revoked.length === 0) throw new AppError('not_found');
  }

  async revokeOtherSessions(session: ActiveSession): Promise<number> {
    const revoked = await this.db.transaction((tx) =>
      this.sessions.revokeInTx(
        tx,
        { realm: session.realm, subjectId: session.subjectId, exceptSessionId: session.id },
        'logout_all',
      ),
    );
    return revoked.length;
  }

  /** Always succeeds from the caller's view; only real, active accounts get an email. */
  async requestPasswordReset(realm: PasswordRealm, email: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const account = await this.subjects.findAccountByEmail(tx, realm, email);
      if (account?.status !== 'active') return;
      await this.outbox.write(tx, passwordResetRequested, {
        aggregateId: account.id,
        organizationId: null,
        actor: { type: 'system', id: 'auth' },
        data: { realm, subjectId: account.id },
      });
    });
  }

  /** Resets the password with a link token and signs out every session. */
  async resetPassword(realm: PasswordRealm, token: string, password: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const challenge = await this.challenges.consumeLink(tx, {
        realm,
        purpose: 'password_reset',
        token,
      });
      const account = challenge?.subjectId
        ? await this.subjects.findAccount(tx, realm, challenge.subjectId, { forUpdate: true })
        : null;
      if (account?.status !== 'active' || account.email !== challenge?.destination) {
        throw new AppError('token_invalid');
      }
      const passwordHash = await this.policy.hashNew(password, account.email);
      await this.subjects.setPasswordHash(tx, realm, account.id, passwordHash);
      await this.subjects.markEmailVerified(tx, realm, account.id, this.clock.now());
      await this.sessions.revokeInTx(tx, { realm, subjectId: account.id }, 'password_changed');
      await this.passwordChangedEvent(tx, account, 'reset');
      await this.audit.record(tx, {
        action: 'auth.password_reset',
        actor: actorOf(account),
        target: { type: targetType(realm), id: account.id },
      });
      await this.attempts.clear(realm, account.email);
    });
  }

  /** Changes the password after re-checking the current one; other sessions are signed out. */
  async changePassword(
    session: ActiveSession,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const account = await this.reauthenticate(session, currentPassword);
    const passwordHash = await this.policy.hashNew(newPassword, account.email, 'newPassword');
    await this.db.transaction(async (tx) => {
      await this.subjects.setPasswordHash(tx, account.realm, account.id, passwordHash);
      await this.sessions.revokeInTx(
        tx,
        { realm: account.realm, subjectId: account.id, exceptSessionId: session.id },
        'password_changed',
      );
      await this.passwordChangedEvent(tx, account, 'change');
      await this.audit.record(tx, {
        action: 'auth.password_changed',
        target: { type: targetType(account.realm), id: account.id },
      });
    });
  }

  /** Re-checks the password for a sensitive action (rule 7); counts toward the lockout. */
  async reauthenticate(session: ActiveSession, password: string): Promise<PasswordAccount> {
    const realm = passwordRealm(session);
    const account = await this.db.transaction((tx) =>
      this.subjects.findAccount(tx, realm, session.subjectId),
    );
    if (!account) throw new UnauthenticatedError();
    await this.attempts.assertNotLocked(realm, account.email);
    if (!(await this.hasher.verify(account.passwordHash, password))) {
      await this.attempts.recordFailure(realm, account.email);
      throw new ForbiddenError('reauthentication_failed');
    }
    return account;
  }

  /** Starts a session in the caller's transaction (signup) or its own (login). */
  async startSessionInTx(
    tx: Tx,
    account: PasswordAccount,
    mfaVerified: boolean,
    usedRecoveryCode = false,
  ): Promise<CreatedSession> {
    const actor = actorOf(account);
    RequestContext.assign({ actor });
    const result = await this.sessions.create(tx, {
      subject: account,
      authMethod: 'password',
      mfaVerified,
    });
    await this.subjects.recordLogin(tx, account.realm, account.id, this.clock.now());
    await this.outbox.write(tx, loginSucceeded, {
      aggregateId: account.id,
      organizationId: null,
      actor,
      data: {
        realm: account.realm,
        subjectId: account.id,
        sessionId: result.row.id,
        newDevice: await this.sessions.isNewDevice(tx, result.row),
        deviceLabel: result.row.deviceLabel,
      },
    });
    await this.audit.record(tx, {
      action: 'auth.login_succeeded',
      actor,
      target: { type: 'session', id: result.row.id },
      context: { realm: account.realm, mfa: mfaVerified, recoveryCode: usedRecoveryCode },
    });
    return result;
  }

  private async startSession(
    account: PasswordAccount,
    mfaVerified: boolean,
    usedRecoveryCode = false,
  ): Promise<SignedIn> {
    const created = await this.db.transaction((tx) =>
      this.startSessionInTx(tx, account, mfaVerified, usedRecoveryCode),
    );
    return { created, account };
  }

  private async passwordChangedEvent(
    tx: Tx,
    account: PasswordAccount,
    via: 'change' | 'reset',
  ): Promise<void> {
    await this.outbox.write(tx, passwordChanged, {
      aggregateId: account.id,
      organizationId: null,
      actor: actorOf(account),
      data: { realm: account.realm, subjectId: account.id, via },
    });
  }
}

export function passwordRealm(session: ActiveSession): PasswordRealm {
  if (session.realm === 'customer') throw new Error('Customers have no password flows yet');
  return session.realm;
}
