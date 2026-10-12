import type { AdminRole } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql } from 'drizzle-orm';

import type { Tx } from '../../../kernel/db/database';
import { mapDbError } from '../../../kernel/db/db-errors';
import { newId } from '../../../kernel/ids/ids';
import {
  platformAdmins,
  type AdminStatus,
  type PlatformAdminRow,
} from '../infrastructure/platform-admins.schema';

export interface AdminChanges {
  name?: string | undefined;
  role?: AdminRole | undefined;
  status?: AdminStatus | undefined;
}

/** The `platform_admins` table (data model 01). Methods run in the caller's transaction. */
@Injectable()
export class PlatformAdminsService {
  async create(
    tx: Tx,
    input: { email: string; name: string; role: AdminRole; passwordHash: string },
  ): Promise<PlatformAdminRow> {
    try {
      const [row] = await tx
        .insert(platformAdmins)
        .values({ id: newId(), ...input })
        .returning();
      if (!row) throw new Error('insert returned no row');
      return row;
    } catch (error) {
      throw mapDbError(error, { platform_admins_email_uq: 'email_taken' });
    }
  }

  async findById(
    tx: Tx,
    id: string,
    options: { forUpdate?: boolean } = {},
  ): Promise<PlatformAdminRow | null> {
    const query = tx.select().from(platformAdmins).where(eq(platformAdmins.id, id));
    const [row] = options.forUpdate ? await query.for('update') : await query;
    return row ?? null;
  }

  async findByEmail(tx: Tx, email: string): Promise<PlatformAdminRow | null> {
    const [row] = await tx.select().from(platformAdmins).where(eq(platformAdmins.email, email));
    return row ?? null;
  }

  /** Newest first; keyset on (created_at, id). */
  async list(
    tx: Tx,
    page: { limit: number; after?: { createdAt: Date; id: string } | undefined },
  ): Promise<PlatformAdminRow[]> {
    const after = page.after;
    return tx
      .select()
      .from(platformAdmins)
      .where(
        after
          ? or(
              lt(platformAdmins.createdAt, after.createdAt),
              and(eq(platformAdmins.createdAt, after.createdAt), lt(platformAdmins.id, after.id)),
            )
          : undefined,
      )
      .orderBy(desc(platformAdmins.createdAt), desc(platformAdmins.id))
      .limit(page.limit);
  }

  async update(tx: Tx, id: string, changes: AdminChanges): Promise<PlatformAdminRow> {
    const [row] = await tx
      .update(platformAdmins)
      .set(changes)
      .where(eq(platformAdmins.id, id))
      .returning();
    if (!row) throw new Error(`Admin ${id} not found`);
    return row;
  }

  /** Active super admins, locked so concurrent demotions cannot remove the last one. */
  async activeSuperAdminIds(tx: Tx): Promise<string[]> {
    const rows = await tx
      .select({ id: platformAdmins.id })
      .from(platformAdmins)
      .where(and(eq(platformAdmins.role, 'super_admin'), eq(platformAdmins.status, 'active')))
      .for('update');
    return rows.map((r) => r.id);
  }

  async setPasswordHash(tx: Tx, id: string, passwordHash: string): Promise<void> {
    await tx.update(platformAdmins).set({ passwordHash }).where(eq(platformAdmins.id, id));
  }

  async recordLogin(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.update(platformAdmins).set({ lastLoginAt: at }).where(eq(platformAdmins.id, id));
  }

  async bumpSessionVersion(tx: Tx, id: string): Promise<void> {
    await tx
      .update(platformAdmins)
      .set({ sessionVersion: sql`${platformAdmins.sessionVersion} + 1` })
      .where(eq(platformAdmins.id, id));
  }
}
