import { mfaChanged } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import { Database, type Tx } from '../../../kernel/db/database';
import { ForbiddenError } from '../../../kernel/errors/app-error';
import { AuditService } from '../../audit/audit.public';
import { OutboxWriter } from '../../outbox/outbox.public';
import { MfaService } from './mfa.service';
import { SessionService, type ActiveSession } from './session.service';
import { UserAuthService } from './user-auth.service';

/** TOTP self-service for business users (FR-AUTH-005). Enrol and disable re-check the password. */
@Injectable()
export class UserMfaService {
  constructor(
    private readonly db: Database,
    private readonly mfa: MfaService,
    private readonly auth: UserAuthService,
    private readonly sessions: SessionService,
    private readonly outbox: OutboxWriter,
    private readonly audit: AuditService,
  ) {}

  async enroll(session: ActiveSession, password: string) {
    const user = await this.auth.reauthenticate(session, password);
    return this.db.transaction((tx) => this.mfa.enroll(tx, 'user', user.id, user.email));
  }

  async confirm(session: ActiveSession, code: string): Promise<string[]> {
    return this.db.transaction(async (tx) => {
      const codes = await this.mfa.confirm(tx, 'user', session.subjectId, code);
      // Proving the factor counts as a second-factor check for this session.
      await this.sessions.markMfaVerified(tx, session);
      await this.changed(tx, session.subjectId, true);
      return codes;
    });
  }

  async disable(session: ActiveSession, password: string): Promise<void> {
    const user = await this.auth.reauthenticate(session, password);
    if (user.mfaRequired) {
      throw new ForbiddenError(
        'forbidden',
        'An organization you belong to requires two-factor authentication',
      );
    }
    await this.db.transaction(async (tx) => {
      await this.mfa.disable(tx, 'user', user.id);
      await this.changed(tx, user.id, false);
    });
  }

  private async changed(tx: Tx, userId: string, enabled: boolean): Promise<void> {
    await this.sessions.refreshSubject(tx, 'user', userId);
    await this.outbox.write(tx, mfaChanged, {
      aggregateId: userId,
      organizationId: null,
      data: { realm: 'user', subjectId: userId, enabled },
    });
    await this.audit.record(tx, {
      action: enabled ? 'auth.mfa_enabled' : 'auth.mfa_disabled',
      target: { type: 'user', id: userId },
    });
  }
}
