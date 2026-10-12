import { platformAdminInvited, type AdminRole } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import type { Actor } from '../../../kernel/context/request-context';
import { randomToken } from '../../../kernel/crypto/secrets';
import { AppConfig } from '../../../kernel/config/app-config';
import { Database, type Tx } from '../../../kernel/db/database';
import { AppError, NotFoundError } from '../../../kernel/errors/app-error';
import {
  createdAtCursor,
  decodeCursor,
  encodeCreatedAtCursor,
  toPage,
} from '../../../kernel/http/cursor';
import { AuditService } from '../../audit/audit.public';
import {
  ChallengeService,
  MfaService,
  PasswordHasher,
  SessionService,
} from '../../auth/auth.public';
import { OutboxWriter } from '../../outbox/outbox.public';
import {
  PlatformAdminsService,
  type AdminChanges,
  type PlatformAdminRow,
} from '../../platform-admins/platform-admins.public';

const INVITATION_TTL_MS = 72 * 3_600_000;

/**
 * Admin users of the console (features/super-admin.md, super_admin only). New admins get
 * an unusable password and an emailed link to set one; TOTP is enforced at first sign-in.
 */
@Injectable()
export class AdminAdminsService {
  constructor(
    private readonly config: AppConfig,
    private readonly db: Database,
    private readonly admins: PlatformAdminsService,
    private readonly sessions: SessionService,
    private readonly mfa: MfaService,
    private readonly hasher: PasswordHasher,
    private readonly challenges: ChallengeService,
    private readonly outbox: OutboxWriter,
    private readonly audit: AuditService,
  ) {}

  async list(page: { limit: number; cursor?: string | undefined }) {
    return this.db.transaction(async (tx) => {
      const rows = await this.admins.list(tx, {
        limit: page.limit + 1,
        after: decodeCursor(page.cursor, createdAtCursor),
      });
      const withMfa = await this.mfa.enabledAmong(
        tx,
        'platform_admin',
        rows.map((r) => r.id),
      );
      return toPage(
        rows,
        page.limit,
        (r) => toAdminAccount(r, withMfa.has(r.id)),
        encodeCreatedAtCursor,
      );
    });
  }

  async get(id: string) {
    return this.db.transaction(async (tx) => {
      const admin = await this.admins.findById(tx, id);
      if (!admin) throw new NotFoundError();
      return toAdminAccount(admin, await this.mfa.isEnabled(tx, 'platform_admin', id));
    });
  }

  async invite(actor: Actor, input: { email: string; name: string; role: AdminRole }) {
    // Unusable until the invitee sets a password through the emailed link.
    const passwordHash = await this.hasher.hash(randomToken());
    return this.db.transaction(async (tx) => {
      const admin = await this.admins.create(tx, { ...input, passwordHash });
      await this.outbox.write(tx, platformAdminInvited, {
        aggregateId: admin.id,
        organizationId: null,
        actor,
        data: { adminId: admin.id },
      });
      await this.audit.record(tx, {
        action: 'platform_admin.created',
        actor,
        target: { type: 'platform_admin', id: admin.id },
        context: { role: admin.role },
      });
      return toAdminAccount(admin, false);
    });
  }

  /**
   * CLI bootstrap (`pnpm admin:create`): creates an admin and returns a set-password link
   * instead of emailing it, so the first admin can be created before email works.
   */
  async createWithLink(input: { email: string; name: string; role: AdminRole }) {
    const actor: Actor = { type: 'system', id: 'admin-cli' };
    const passwordHash = await this.hasher.hash(randomToken());
    return this.db.transaction(async (tx) => {
      const admin = await this.admins.create(tx, { ...input, passwordHash });
      const { token, challenge } = await this.challenges.createLink(tx, {
        realm: 'platform_admin',
        purpose: 'password_reset',
        subjectId: admin.id,
        destination: admin.email,
        context: { kind: 'admin_invitation', via: 'cli' },
        ttlMs: INVITATION_TTL_MS,
      });
      await this.audit.record(tx, {
        action: 'platform_admin.created',
        actor,
        target: { type: 'platform_admin', id: admin.id },
        context: { role: admin.role, via: 'cli' },
      });
      const adminUrl = this.config.get('ADMIN_URL', { infer: true }).replace(/\/$/, '');
      return {
        admin: toAdminAccount(admin, false),
        link: `${adminUrl}/reset-password?token=${token}`,
        expiresAt: challenge.expiresAt,
      };
    });
  }

  async update(actor: Actor, id: string, changes: AdminChanges) {
    return this.db.transaction(async (tx) => {
      const before = await this.admins.findById(tx, id, { forUpdate: true });
      if (!before) throw new NotFoundError();
      await this.keepOneSuperAdmin(tx, before, changes);
      const after = await this.admins.update(tx, id, changes);

      if (before.status === 'active' && after.status === 'disabled') {
        await this.admins.bumpSessionVersion(tx, id);
        await this.sessions.revokeInTx(tx, { realm: 'platform_admin', subjectId: id }, 'admin');
      } else if (before.role !== after.role) {
        // Sessions cache the role; reload them so the new role applies on the next request.
        await this.sessions.refreshSubject(tx, 'platform_admin', id);
      }
      const diff = Object.fromEntries(
        (['name', 'role', 'status'] as const)
          .filter((k) => before[k] !== after[k])
          .map((k) => [k, [before[k], after[k]] as [unknown, unknown]]),
      );
      if (Object.keys(diff).length > 0) {
        await this.audit.record(tx, {
          action: 'platform_admin.updated',
          actor,
          target: { type: 'platform_admin', id },
          changes: diff,
        });
      }
      return toAdminAccount(after, await this.mfa.isEnabled(tx, 'platform_admin', id));
    });
  }

  /** Demoting or disabling must leave at least one active super admin (locks them all). */
  private async keepOneSuperAdmin(
    tx: Tx,
    target: PlatformAdminRow,
    changes: AdminChanges,
  ): Promise<void> {
    const losesSuper =
      target.role === 'super_admin' &&
      target.status === 'active' &&
      ((changes.role !== undefined && changes.role !== 'super_admin') ||
        changes.status === 'disabled');
    if (!losesSuper) return;
    const supers = await this.admins.activeSuperAdminIds(tx);
    if (supers.filter((s) => s !== target.id).length === 0) throw new AppError('last_super_admin');
  }
}

export function toAdminAccount(admin: PlatformAdminRow, mfaEnabled: boolean) {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    status: admin.status,
    mfaEnabled,
    lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
    createdAt: admin.createdAt.toISOString(),
  };
}
