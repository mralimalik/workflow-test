import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { AccountController } from './api/account.controller';
import { AdminAuthController } from './api/admin-auth.controller';
import { AuthGuard } from './api/auth.guard';
import { SessionCookies } from './api/session-cookies';
import { UserAuthController } from './api/user-auth.controller';
import { AccountService } from './application/account.service';
import { ChallengeCleanupTask, SessionCleanupTask } from './application/auth-cleanup.task';
import { BreachedPasswordChecker } from './application/breached-passwords';
import { ChallengeService } from './application/challenge.service';
import { LoginAttempts } from './application/login-attempts';
import { MfaLoginTokens } from './application/mfa-login-tokens';
import { MfaService } from './application/mfa.service';
import { PasswordHasher } from './application/password-hasher';
import { PasswordPolicy } from './application/password-policy.service';
import { SessionService } from './application/session.service';
import { SessionSocketAuthenticator } from './application/session-socket-authenticator';
import { Subjects } from './application/subjects';
import { UserAuthService } from './application/user-auth.service';
import { MfaSelfService } from './application/mfa-self-service';
import { PasswordAuthService } from './application/password-auth.service';
import { AuthNotificationsHandler } from './events/auth-notifications.handler';
import { ChallengesRepository } from './infrastructure/challenges.repository';
import { MfaRepository } from './infrastructure/mfa.repository';
import { SessionCache } from './infrastructure/session-cache';
import { SessionsRepository } from './infrastructure/sessions.repository';

/** Sessions, challenges, MFA and password handling shared by the api and worker. */
@Module({
  providers: [
    SessionsRepository,
    ChallengesRepository,
    MfaRepository,
    SessionCache,
    Subjects,
    SessionService,
    ChallengeService,
    MfaService,
    PasswordHasher,
    BreachedPasswordChecker,
    PasswordPolicy,
  ],
  exports: [
    SessionsRepository,
    ChallengesRepository,
    SessionService,
    ChallengeService,
    MfaService,
    PasswordHasher,
    PasswordPolicy,
    Subjects,
  ],
})
export class AuthCoreModule {}

/**
 * Authentication (api process): the global auth guard, auth and account endpoints, and the
 * socket authenticator for the realtime gateway (features/auth-and-identity.md).
 */
@Module({
  imports: [AuthCoreModule],
  controllers: [UserAuthController, AdminAuthController, AccountController],
  providers: [
    PasswordAuthService,
    UserAuthService,
    MfaSelfService,
    AccountService,
    LoginAttempts,
    MfaLoginTokens,
    SessionCookies,
    SessionSocketAuthenticator,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthCoreModule, SessionSocketAuthenticator],
})
export class AuthModule {}

/** Auth emails and nightly cleanup (worker process). */
@Module({
  imports: [AuthCoreModule],
  providers: [AuthNotificationsHandler, SessionCleanupTask, ChallengeCleanupTask],
})
export class AuthWorkerModule {}
