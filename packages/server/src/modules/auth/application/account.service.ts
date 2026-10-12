import type { AdminSession, CurrentUser, UserSession } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import { Database, type Tx } from '../../../kernel/db/database';
import { AppError, NotFoundError, UnauthenticatedError } from '../../../kernel/errors/app-error';
import { AuditService } from '../../audit/audit.public';
import { FilesService, type SignedUrl } from '../../files/files.public';
import { PlatformAdminsService } from '../../platform-admins/platform-admins.public';
import { UsersService, type ProfileChanges, type UserRow } from '../../users/users.public';
import { MfaService } from './mfa.service';
import type { ActiveSession } from './session.service';

/**
 * The signed-in user's own account: the session bootstrap document and profile
 * self-service (name, phone, locale, timezone, avatar).
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly db: Database,
    private readonly users: UsersService,
    private readonly admins: PlatformAdminsService,
    private readonly mfa: MfaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  async currentUser(tx: Tx, userOrId: UserRow | string): Promise<CurrentUser> {
    const user = typeof userOrId === 'string' ? await this.users.findById(tx, userOrId) : userOrId;
    if (!user) throw new UnauthenticatedError();
    const mfaEnabled = await this.mfa.isEnabled(tx, 'user', user.id);
    return toCurrentUser(user, mfaEnabled, this.avatarUrl(user));
  }

  async sessionDocument(session: ActiveSession, user?: UserRow): Promise<UserSession> {
    const current = await this.db.transaction((tx) =>
      this.currentUser(tx, user ?? session.subjectId),
    );
    return { user: current, ...sessionParts(session) };
  }

  /** The admin console's bootstrap document. */
  async adminSessionDocument(session: ActiveSession): Promise<AdminSession> {
    return this.db.transaction(async (tx) => {
      const admin = await this.admins.findById(tx, session.subjectId);
      if (!admin) throw new UnauthenticatedError();
      return {
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          mfaEnabled: await this.mfa.isEnabled(tx, 'platform_admin', admin.id),
          createdAt: admin.createdAt.toISOString(),
        },
        ...sessionParts(session),
      };
    });
  }

  async get(userId: string): Promise<CurrentUser> {
    return this.db.transaction((tx) => this.currentUser(tx, userId));
  }

  async update(userId: string, changes: ProfileChanges): Promise<CurrentUser> {
    return this.db.transaction(async (tx) => {
      const before = await this.users.findById(tx, userId, { forUpdate: true });
      if (!before) throw new UnauthenticatedError();
      if (changes.avatarFileId) {
        const file = await this.files.findOwned(tx, changes.avatarFileId, {
          ownerType: 'user',
          ownerId: userId,
          purpose: 'avatar',
        });
        if (!file) throw new NotFoundError('not_found', 'No uploaded avatar with this id');
      }
      const after = await this.users.updateProfile(tx, userId, changes);
      const diff = Object.fromEntries(
        (Object.keys(changes) as (keyof ProfileChanges)[])
          .filter((k) => before[k] !== after[k])
          .map((k) => [k, [before[k], after[k]] as [unknown, unknown]]),
      );
      if (Object.keys(diff).length > 0) {
        await this.audit.record(tx, {
          action: 'user.profile_updated',
          target: { type: 'user', id: userId },
          changes: diff,
        });
      }
      return this.currentUser(tx, after);
    });
  }

  async createAvatarUpload(
    userId: string,
    input: { contentType: string; sizeBytes: number },
  ): Promise<{ fileId: string; upload: SignedUrl & { method: 'PUT' } }> {
    const { fileId, upload } = await this.db.transaction((tx) =>
      this.files.createUpload(tx, {
        organizationId: null,
        ownerType: 'user',
        ownerId: userId,
        purpose: 'avatar',
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        uploadedBy: { type: 'user', id: userId },
      }),
    );
    if (upload.method !== 'PUT') throw new AppError('internal_error');
    return { fileId, upload: { ...upload, method: 'PUT' } };
  }

  private avatarUrl(user: UserRow): SignedUrl | null {
    return user.avatarFileId
      ? this.files.downloadUrl({ id: user.avatarFileId, organizationId: null, status: 'ready' })
      : null;
  }
}

function sessionParts(session: ActiveSession) {
  return {
    session: {
      id: session.id,
      authMethod: session.authMethod,
      mfaVerified: session.mfaVerifiedAt !== null,
      createdAt: session.createdAt,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    },
    csrfToken: session.csrfToken,
    mfaEnrollmentRequired: session.mfaPending,
  };
}

function toCurrentUser(user: UserRow, mfaEnabled: boolean, avatar: SignedUrl | null): CurrentUser {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerifiedAt !== null,
    firstName: user.firstName,
    lastName: user.lastName,
    phoneE164: user.phoneE164,
    locale: user.locale,
    timezone: user.timezone,
    avatar:
      avatar && user.avatarFileId
        ? { fileId: user.avatarFileId, url: avatar.url, expiresAt: avatar.expiresAt }
        : null,
    mfaEnabled,
    createdAt: user.createdAt.toISOString(),
  };
}
