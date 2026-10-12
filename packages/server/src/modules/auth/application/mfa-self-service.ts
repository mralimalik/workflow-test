import { mfaChanged } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import { Database, type Tx } from '../../../kernel/db/database';
import { ForbiddenError } from '../../../kernel/errors/app-error';
import { AuditService } from '../../audit/audit.public';
import { OutboxWriter } from '../../outbox/outbox.public';
import { MfaService } from './mfa.service';
import { PasswordAuthService, passwordRealm } from './password-auth.service';
import { SessionService, type ActiveSession } from './session.service';

/**
 * TOTP self-service for password realms (FR-AUTH-005). Enrol and disable re-check the
 * password; disabling is refused while a second factor is required (admins always).
 */
@Injectable()
export class MfaSelfService {
  constructor(
    private readonly db: Database,
    private readonly mfa: MfaService,
    private readonly auth: PasswordAuthService,
    private readonly sessions: SessionService,
    private readonly outbox: OutboxWriter,
    private readonly audit: AuditService,
  ) {}

  async enroll(session: ActiveSession, password: string) {
    const account = await this.auth.reauthenticate(session, password);
    return this.db.transaction((tx) =>
      this.mfa.enroll(tx, passwordRealm(session), account.id, account.email),
    );
  }

  async confirm(session: ActiveSession, code: string): Promise<string[]> {
    const realm = passwordRealm(session);
    return this.db.transaction(async (tx) => {
      const codes = await this.mfa.confirm(tx, realm, session.subjectId, code);
      // Proving the factor counts as a second-factor check for this session.
      await this.sessions.markMfaVerified(tx, session);
      await this.changed(tx, session, true);
      return codes;
    });
  }

  async disable(session: ActiveSession, password: string): Promise<void> {
    const account = await this.auth.reauthenticate(session, password);
    if (account.mfaRequired) {
      throw new ForbiddenError(
        'forbidden',
        account.realm === 'platform_admin'
          ? 'Platform admins must use two-factor authentication'
          : 'An organization you belong to requires two-factor authentication',
      );
    }
    await this.db.transaction(async (tx) => {
      await this.mfa.disable(tx, passwordRealm(session), account.id);
      await this.changed(tx, session, false);
    });
  }

  private async changed(tx: Tx, session: ActiveSession, enabled: boolean): Promise<void> {
    await this.sessions.refreshSubject(tx, session.realm, session.subjectId);
    await this.outbox.write(tx, mfaChanged, {
      aggregateId: session.subjectId,
      organizationId: null,
      data: { realm: session.realm, subjectId: session.subjectId, enabled },
    });
    await this.audit.record(tx, {
      action: enabled ? 'auth.mfa_enabled' : 'auth.mfa_disabled',
      target: {
        type: session.realm === 'user' ? 'user' : 'platform_admin',
        id: session.subjectId,
      },
    });
  }
}
