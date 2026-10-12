import {
  userEmailVerificationRequested,
  userEmailVerified,
  userSignedUp,
} from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import { Database } from '../../../kernel/db/database';
import { AppError } from '../../../kernel/errors/app-error';
import { Clock } from '../../../kernel/time/clock';
import { AuditService } from '../../audit/audit.public';
import { OutboxWriter } from '../../outbox/outbox.public';
import { UsersService } from '../../users/users.public';
import { ChallengeService } from './challenge.service';
import { PasswordAuthService, type SignedIn } from './password-auth.service';
import { PasswordPolicy } from './password-policy.service';
import type { ActiveSession } from './session.service';
import { fromUser } from './subjects';

/** Flows only business users have: signup and email verification (FR-AUTH-001). */
@Injectable()
export class UserAuthService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersService,
    private readonly auth: PasswordAuthService,
    private readonly challenges: ChallengeService,
    private readonly policy: PasswordPolicy,
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
  }): Promise<SignedIn> {
    const passwordHash = await this.policy.hashNew(input.password, input.email);
    return this.db.transaction(async (tx) => {
      const account = fromUser(await this.users.create(tx, { ...input, passwordHash }));
      const actor = { type: 'user', id: account.id } as const;
      const created = await this.auth.startSessionInTx(tx, account, false);
      await this.outbox.write(tx, userSignedUp, {
        aggregateId: account.id,
        organizationId: null,
        actor,
        data: { userId: account.id },
      });
      await this.audit.record(tx, {
        action: 'user.signed_up',
        actor,
        target: { type: 'user', id: account.id },
      });
      return { created, account };
    });
  }

  async verifyEmail(token: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const challenge = await this.challenges.consumeLink(tx, {
        realm: 'user',
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
}
