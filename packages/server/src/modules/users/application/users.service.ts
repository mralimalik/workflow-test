import { Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';

import type { Tx } from '../../../kernel/db/database';
import { mapDbError } from '../../../kernel/db/db-errors';
import { newId } from '../../../kernel/ids/ids';
import { users, type UserRow, type UserStatus } from '../infrastructure/users.schema';

export interface NewUser {
  email: string;
  passwordHash: string | null;
  firstName: string;
  lastName?: string | null | undefined;
  locale?: string | undefined;
  timezone?: string | null | undefined;
}

export interface ProfileChanges {
  firstName?: string | undefined;
  lastName?: string | null | undefined;
  phoneE164?: string | null | undefined;
  locale?: string | undefined;
  timezone?: string | null | undefined;
  avatarFileId?: string | null | undefined;
}

/**
 * The `users` table (data model 01). Global, not tenant-scoped; every method runs in the
 * caller's transaction. Authentication rules live in the auth module.
 */
@Injectable()
export class UsersService {
  async create(tx: Tx, input: NewUser): Promise<UserRow> {
    try {
      const [row] = await tx
        .insert(users)
        .values({
          id: newId(),
          email: input.email,
          passwordHash: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName ?? null,
          locale: input.locale ?? 'en',
          timezone: input.timezone ?? null,
        })
        .returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    } catch (error) {
      throw mapDbError(error, { users_email_uq: 'email_taken' });
    }
  }

  async findById(
    tx: Tx,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<UserRow | null> {
    const query = tx.select().from(users).where(eq(users.id, id));
    const [row] = options.forUpdate ? await query.for('update') : await query;
    return row ?? null;
  }

  /** Case-insensitive (`citext`). */
  async findByEmail(tx: Tx, email: string): Promise<UserRow | null> {
    const [row] = await tx.select().from(users).where(eq(users.email, email));
    return row ?? null;
  }

  async setPasswordHash(tx: Tx, id: string, passwordHash: string): Promise<void> {
    await tx.update(users).set({ passwordHash }).where(eq(users.id, id));
  }

  /** Sets `email_verified_at` once; returns false when it was already set. */
  async markEmailVerified(tx: Tx, id: string, at: Date): Promise<boolean> {
    const rows = await tx
      .update(users)
      .set({ emailVerifiedAt: at })
      .where(and(eq(users.id, id), isNull(users.emailVerifiedAt)))
      .returning({ id: users.id });
    return rows.length > 0;
  }

  async recordLogin(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.update(users).set({ lastLoginAt: at }).where(eq(users.id, id));
  }

  async updateProfile(tx: Tx, id: string, changes: ProfileChanges): Promise<UserRow> {
    const [row] = await tx.update(users).set(changes).where(eq(users.id, id)).returning();
    if (!row) throw new Error(`User ${id} not found`);
    return row;
  }

  /**
   * Admin search: `q` matches email or name (case-insensitive substring), newest first,
   * keyset on (created_at, id).
   */
  async search(
    tx: Tx,
    filter: {
      q?: string | undefined;
      status?: UserStatus | undefined;
      limit: number;
      after?: { createdAt: Date; id: string } | undefined;
    },
  ): Promise<UserRow[]> {
    const pattern = filter.q ? `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : undefined;
    const after = filter.after;
    return tx
      .select()
      .from(users)
      .where(
        and(
          pattern
            ? or(
                ilike(users.email, pattern),
                ilike(sql`${users.firstName} || ' ' || coalesce(${users.lastName}, '')`, pattern),
              )
            : undefined,
          filter.status ? eq(users.status, filter.status) : undefined,
          after
            ? or(
                lt(users.createdAt, after.createdAt),
                and(eq(users.createdAt, after.createdAt), lt(users.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(filter.limit);
  }

  /** Ban or lift a ban (FR-AUTH-006); callers revoke sessions in the same transaction. */
  async setBan(tx: Tx, id: string, ban: { reason: string; at: Date } | null): Promise<UserRow> {
    const [row] = await tx
      .update(users)
      .set(
        ban
          ? {
              status: 'banned',
              bannedAt: ban.at,
              banReason: ban.reason,
              sessionVersion: sql`${users.sessionVersion} + 1`,
            }
          : { status: 'active', bannedAt: null, banReason: null },
      )
      .where(eq(users.id, id))
      .returning();
    if (!row) throw new Error(`User ${id} not found`);
    return row;
  }

  /** Invalidates every token carrying the old version (bans, A5). */
  async bumpSessionVersion(tx: Tx, id: string): Promise<number> {
    const [row] = await tx
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, id))
      .returning({ sessionVersion: users.sessionVersion });
    if (!row) throw new Error(`User ${id} not found`);
    return row.sessionVersion;
  }
}
