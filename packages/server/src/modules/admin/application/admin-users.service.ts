import { subjectBanned, subjectUnbanned } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import type { Actor } from '../../../kernel/context/request-context';
import { Database } from '../../../kernel/db/database';
import { ConflictError, NotFoundError } from '../../../kernel/errors/app-error';
import {
  createdAtCursor,
  decodeCursor,
  encodeCreatedAtCursor,
  toPage,
} from '../../../kernel/http/cursor';
import { Clock } from '../../../kernel/time/clock';
import { AuditService } from '../../audit/audit.public';
import { MfaService, SessionService } from '../../auth/auth.public';
import { OutboxWriter } from '../../outbox/outbox.public';
import { UsersService, type UserRow, type UserStatus } from '../../users/users.public';

/** Support operations on business users (features/super-admin.md; FR-AUTH-006). */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly outbox: OutboxWriter,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async search(filter: {
    q?: string | undefined;
    status?: UserStatus | undefined;
    limit: number;
    cursor?: string | undefined;
  }) {
    return this.db.transaction(async (tx) => {
      const rows = await this.users.search(tx, {
        q: filter.q,
        status: filter.status,
        limit: filter.limit + 1,
        after: decodeCursor(filter.cursor, createdAtCursor),
      });
      const withMfa = await this.mfa.enabledAmong(
        tx,
        'user',
        rows.map((r) => r.id),
      );
      return toPage(
        rows,
        filter.limit,
        (r) => toAdminUser(r, withMfa.has(r.id)),
        encodeCreatedAtCursor,
      );
    });
  }

  async get(id: string) {
    const user = await this.db.transaction(async (tx) => {
      const row = await this.users.findById(tx, id);
      if (!row) throw new NotFoundError();
      return toAdminUser(row, await this.mfa.isEnabled(tx, 'user', id));
    });
    const sessions = await this.sessions.list('user', id);
    return {
      ...user,
      sessions: sessions.map((s) => ({
        id: s.id,
        authMethod: s.authMethod,
        deviceLabel: s.deviceLabel,
        ip: s.ip,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
      })),
    };
  }

  /** Bans the user, bumps their session version and revokes every session at once. */
  async ban(actor: Actor, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const user = await this.users.findById(tx, id, { forUpdate: true });
      if (!user) throw new NotFoundError();
      if (user.status === 'banned')
        throw new ConflictError('conflict', 'The user is already banned');
      const banned = await this.users.setBan(tx, id, { reason, at: this.clock.now() });
      await this.sessions.revokeInTx(tx, { realm: 'user', subjectId: id }, 'banned');
      await this.outbox.write(tx, subjectBanned, {
        aggregateId: id,
        organizationId: null,
        actor,
        data: { realm: 'user', subjectId: id, reason },
      });
      await this.audit.record(tx, {
        action: 'user.banned',
        actor,
        target: { type: 'user', id },
        changes: { status: [user.status, 'banned'] },
        context: { reason },
      });
      return toAdminUser(banned, await this.mfa.isEnabled(tx, 'user', id));
    });
  }

  async unban(actor: Actor, id: string, reason: string) {
    return this.db.transaction(async (tx) => {
      const user = await this.users.findById(tx, id, { forUpdate: true });
      if (!user) throw new NotFoundError();
      if (user.status !== 'banned') throw new ConflictError('conflict', 'The user is not banned');
      const active = await this.users.setBan(tx, id, null);
      await this.outbox.write(tx, subjectUnbanned, {
        aggregateId: id,
        organizationId: null,
        actor,
        data: { realm: 'user', subjectId: id },
      });
      await this.audit.record(tx, {
        action: 'user.unbanned',
        actor,
        target: { type: 'user', id },
        changes: { status: ['banned', 'active'] },
        context: { reason },
      });
      return toAdminUser(active, await this.mfa.isEnabled(tx, 'user', id));
    });
  }

  async revokeSessions(actor: Actor, id: string, reason: string): Promise<number> {
    return this.db.transaction(async (tx) => {
      if (!(await this.users.findById(tx, id))) throw new NotFoundError();
      const revoked = await this.sessions.revokeInTx(tx, { realm: 'user', subjectId: id }, 'admin');
      await this.audit.record(tx, {
        action: 'user.sessions_revoked',
        actor,
        target: { type: 'user', id },
        context: { reason, count: revoked.length },
      });
      return revoked.length;
    });
  }
}

function toAdminUser(user: UserRow, mfaEnabled: boolean) {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status,
    bannedAt: user.bannedAt?.toISOString() ?? null,
    banReason: user.banReason,
    mfaEnabled,
    lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}
