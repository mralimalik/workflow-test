import type { Realm } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import type { Tx } from '../../../kernel/db/database';
import {
  PlatformAdminsService,
  type PlatformAdminRow,
} from '../../platform-admins/platform-admins.public';
import { UsersService, type UserRow } from '../../users/users.public';

/** What authentication needs to know about a subject, whatever its realm. */
export interface AuthSubject {
  id: string;
  realm: Realm;
  email: string | null;
  status: 'active' | 'disabled' | 'banned' | 'deleted';
  sessionVersion: number;
  /** A second factor is required (an organization requires it, or the realm always does). */
  mfaRequired: boolean;
  /** Admin role; null in other realms. */
  role: string | null;
}

/** A password-capable account (users, platform admins). */
export interface PasswordAccount extends AuthSubject {
  realm: PasswordRealm;
  email: string;
  passwordHash: string | null;
  /** First name or display name, for emails. */
  greetingName: string;
  locale: string;
  timezone: string | null;
}

export type PasswordRealm = 'user' | 'platform_admin';

/**
 * Looks up subjects by realm. Each realm's table is owned by its module (`users`,
 * `platform-admins`, later `customers`); this is the only place auth reads them.
 */
@Injectable()
export class Subjects {
  constructor(
    private readonly users: UsersService,
    private readonly admins: PlatformAdminsService,
  ) {}

  async find(tx: Tx, realm: Realm, id: string): Promise<AuthSubject | null> {
    if (realm === 'customer') return null; // Phase 1
    return this.findAccount(tx, realm, id);
  }

  async findAccount(
    tx: Tx,
    realm: PasswordRealm,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<PasswordAccount | null> {
    if (realm === 'user') {
      const user = await this.users.findById(tx, id, options);
      return user ? fromUser(user) : null;
    }
    const admin = await this.admins.findById(tx, id, options);
    return admin ? fromAdmin(admin) : null;
  }

  async findAccountByEmail(
    tx: Tx,
    realm: PasswordRealm,
    email: string,
  ): Promise<PasswordAccount | null> {
    if (realm === 'user') {
      const user = await this.users.findByEmail(tx, email);
      return user ? fromUser(user) : null;
    }
    const admin = await this.admins.findByEmail(tx, email);
    return admin ? fromAdmin(admin) : null;
  }

  async setPasswordHash(tx: Tx, realm: PasswordRealm, id: string, hash: string): Promise<void> {
    if (realm === 'user') await this.users.setPasswordHash(tx, id, hash);
    else await this.admins.setPasswordHash(tx, id, hash);
  }

  async recordLogin(tx: Tx, realm: PasswordRealm, id: string, at: Date): Promise<void> {
    if (realm === 'user') await this.users.recordLogin(tx, id, at);
    else await this.admins.recordLogin(tx, id, at);
  }

  /** Users track email verification; admin emails are set by a super admin. */
  async isEmailVerified(tx: Tx, realm: PasswordRealm, id: string): Promise<boolean> {
    if (realm !== 'user') return true;
    const user = await this.users.findById(tx, id);
    return Boolean(user?.emailVerifiedAt);
  }

  /** A completed reset proves control of the mailbox (users have a verified flag). */
  async markEmailVerified(tx: Tx, realm: PasswordRealm, id: string, at: Date): Promise<void> {
    if (realm === 'user') await this.users.markEmailVerified(tx, id, at);
  }
}

export function fromUser(user: UserRow): PasswordAccount {
  return {
    id: user.id,
    realm: 'user',
    email: user.email,
    status: user.status,
    sessionVersion: user.sessionVersion,
    mfaRequired: user.mfaRequired,
    role: null,
    passwordHash: user.passwordHash,
    greetingName: user.firstName,
    locale: user.locale,
    timezone: user.timezone,
  };
}

export function fromAdmin(admin: PlatformAdminRow): PasswordAccount {
  return {
    id: admin.id,
    realm: 'platform_admin',
    email: admin.email,
    status: admin.status,
    sessionVersion: admin.sessionVersion,
    // Admins must always use a second factor (features/auth-and-identity.md rule 6).
    mfaRequired: true,
    role: admin.role,
    passwordHash: admin.passwordHash,
    greetingName: admin.name,
    locale: 'en',
    timezone: null,
  };
}
