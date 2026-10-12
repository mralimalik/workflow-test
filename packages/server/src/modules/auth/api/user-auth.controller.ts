import { Controller, Res } from '@nestjs/common';
import { routes, type RouteInput, type RouteResult } from '@attendra/contracts';
import type { Response } from 'express';

import { ContractBody, ContractParams, ContractRoute } from '../../../kernel/http/contract-route';
import { AccountService } from '../application/account.service';
import {
  SessionService,
  type ActiveSession,
  type CreatedSession,
} from '../application/session.service';
import { UserAuthService } from '../application/user-auth.service';
import { UserMfaService } from '../application/user-mfa.service';
import type { UserRow } from '../../users/users.public';
import { CurrentSession } from './auth.guard';
import { SessionCookies } from './session-cookies';

const r = routes.userAuth;
type In<K extends keyof typeof r> = RouteInput<(typeof r)[K]>;
type Out<K extends keyof typeof r> = RouteResult<(typeof r)[K]>;

/** Business-user authentication endpoints (contracts: routes.userAuth). */
@Controller()
export class UserAuthController {
  constructor(
    private readonly auth: UserAuthService,
    private readonly mfa: UserMfaService,
    private readonly sessions: SessionService,
    private readonly account: AccountService,
    private readonly cookies: SessionCookies,
  ) {}

  @ContractRoute(r.signup)
  async signup(
    @ContractBody(r.signup) body: In<'signup'>['body'],
    @Res({ passthrough: true }) res: Response,
  ): Promise<Out<'signup'>> {
    return this.signIn(res, await this.auth.signup(body));
  }

  @ContractRoute(r.login)
  async login(
    @ContractBody(r.login) body: In<'login'>['body'],
    @Res({ passthrough: true }) res: Response,
  ): Promise<Out<'login'>> {
    const outcome = await this.auth.login(body.email, body.password);
    if (outcome.status === 'mfa_required') {
      return {
        status: 'mfa_required',
        mfaToken: outcome.mfaToken,
        methods: ['totp', 'recovery_code'],
        expiresAt: outcome.expiresAt.toISOString(),
      };
    }
    return { status: 'authenticated', ...(await this.signIn(res, outcome)) };
  }

  @ContractRoute(r.mfaVerify)
  async mfaVerify(
    @ContractBody(r.mfaVerify) body: In<'mfaVerify'>['body'],
    @Res({ passthrough: true }) res: Response,
  ): Promise<Out<'mfaVerify'>> {
    const proof = 'code' in body ? { code: body.code } : { recoveryCode: body.recoveryCode };
    return this.signIn(res, await this.auth.completeMfa(body.mfaToken, proof));
  }

  @ContractRoute(r.session)
  session(@CurrentSession() session: ActiveSession): Promise<Out<'session'>> {
    return this.account.sessionDocument(session);
  }

  @ContractRoute(r.logout)
  async logout(
    @CurrentSession() session: ActiveSession,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(session);
    this.cookies.clear(res, 'user');
  }

  @ContractRoute(r.listSessions)
  async listSessions(@CurrentSession() session: ActiveSession): Promise<Out<'listSessions'>> {
    const rows = await this.sessions.list('user', session.subjectId);
    return {
      data: rows.map((row) => ({
        id: row.id,
        current: row.id === session.id,
        authMethod: row.authMethod,
        deviceLabel: row.deviceLabel,
        ip: row.ip,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
      })),
    };
  }

  @ContractRoute(r.revokeSession)
  async revokeSession(
    @CurrentSession() session: ActiveSession,
    @ContractParams(r.revokeSession) params: In<'revokeSession'>['params'],
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.revokeSession(session, params.sessionId);
    if (params.sessionId === session.id) this.cookies.clear(res, 'user');
  }

  @ContractRoute(r.revokeOtherSessions)
  async revokeOtherSessions(
    @CurrentSession() session: ActiveSession,
  ): Promise<Out<'revokeOtherSessions'>> {
    return { revoked: await this.auth.revokeOtherSessions(session) };
  }

  @ContractRoute(r.forgotPassword)
  async forgotPassword(@ContractBody(r.forgotPassword) body: In<'forgotPassword'>['body']) {
    await this.auth.requestPasswordReset(body.email);
  }

  @ContractRoute(r.resetPassword)
  async resetPassword(@ContractBody(r.resetPassword) body: In<'resetPassword'>['body']) {
    await this.auth.resetPassword(body.token, body.password);
  }

  @ContractRoute(r.changePassword)
  async changePassword(
    @CurrentSession() session: ActiveSession,
    @ContractBody(r.changePassword) body: In<'changePassword'>['body'],
  ) {
    await this.auth.changePassword(session, body.currentPassword, body.newPassword);
  }

  @ContractRoute(r.verifyEmail)
  async verifyEmail(@ContractBody(r.verifyEmail) body: In<'verifyEmail'>['body']) {
    await this.auth.verifyEmail(body.token);
  }

  @ContractRoute(r.resendVerification)
  async resendVerification(@CurrentSession() session: ActiveSession) {
    await this.auth.resendVerification(session);
  }

  @ContractRoute(r.totpEnroll)
  async totpEnroll(
    @CurrentSession() session: ActiveSession,
    @ContractBody(r.totpEnroll) body: In<'totpEnroll'>['body'],
  ): Promise<Out<'totpEnroll'>> {
    const enrolment = await this.mfa.enroll(session, body.password);
    return { ...enrolment, expiresAt: enrolment.expiresAt.toISOString() };
  }

  @ContractRoute(r.totpConfirm)
  async totpConfirm(
    @CurrentSession() session: ActiveSession,
    @ContractBody(r.totpConfirm) body: In<'totpConfirm'>['body'],
  ): Promise<Out<'totpConfirm'>> {
    return { recoveryCodes: await this.mfa.confirm(session, body.code) };
  }

  @ContractRoute(r.totpDisable)
  async totpDisable(
    @CurrentSession() session: ActiveSession,
    @ContractBody(r.totpDisable) body: In<'totpDisable'>['body'],
  ) {
    await this.mfa.disable(session, body.password);
  }

  private async signIn(
    res: Response,
    result: { created: CreatedSession; user: UserRow },
  ): Promise<Out<'session'>> {
    const { token, session } = result.created;
    this.cookies.set(res, 'user', token, new Date(session.absoluteExpiresAt));
    return this.account.sessionDocument(session, result.user);
  }
}
