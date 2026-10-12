import type { Realm } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';

import type { Tx } from '../../../kernel/db/database';
import { sessions, type RevokeReason, type SessionRow } from './auth.schema';

export type NewSession = typeof sessions.$inferInsert;

/** Persistence for `sessions` (data model 01). Token hashes are hex in the application. */
@Injectable()
export class SessionsRepository {
  async insert(tx: Tx, row: NewSession): Promise<SessionRow> {
    const [created] = await tx.insert(sessions).values(row).returning();
    if (!created) throw new Error('insert returned no row');
    return created;
  }

  async findActiveByTokenHash(tx: Tx, tokenHash: Buffer): Promise<SessionRow | null> {
    const [row] = await tx
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)));
    return row ?? null;
  }

  async listActive(tx: Tx, realm: Realm, subjectId: string, now: Date): Promise<SessionRow[]> {
    return tx
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.subjectType, realm),
          eq(sessions.subjectId, subjectId),
          isNull(sessions.revokedAt),
          gt(sessions.idleExpiresAt, now),
          gt(sessions.absoluteExpiresAt, now),
        ),
      )
      .orderBy(desc(sessions.lastSeenAt));
  }

  /** Records activity; returns false when the session was revoked meanwhile. */
  async touch(tx: Tx, id: string, lastSeenAt: Date, idleExpiresAt: Date): Promise<boolean> {
    const rows = await tx
      .update(sessions)
      .set({ lastSeenAt, idleExpiresAt })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    return rows.length > 0;
  }

  async markMfaVerified(tx: Tx, id: string, at: Date): Promise<void> {
    await tx.update(sessions).set({ mfaVerifiedAt: at }).where(eq(sessions.id, id));
  }

  /**
   * Revokes the subject's active sessions matching the filter; returns the revoked ids and
   * token hashes (for cache eviction).
   */
  async revoke(
    tx: Tx,
    filter: { realm: Realm; subjectId: string; sessionId?: string; exceptSessionId?: string },
    reason: RevokeReason,
    at: Date,
  ): Promise<{ id: string; tokenHash: Buffer }[]> {
    return tx
      .update(sessions)
      .set({ revokedAt: at, revokeReason: reason })
      .where(
        and(
          eq(sessions.subjectType, filter.realm),
          eq(sessions.subjectId, filter.subjectId),
          isNull(sessions.revokedAt),
          filter.sessionId ? eq(sessions.id, filter.sessionId) : undefined,
          filter.exceptSessionId ? ne(sessions.id, filter.exceptSessionId) : undefined,
        ),
      )
      .returning({ id: sessions.id, tokenHash: sessions.tokenHash });
  }

  /** True when an earlier session of the subject came from this device label. */
  async seenDevice(
    tx: Tx,
    realm: Realm,
    subjectId: string,
    deviceLabel: string,
    exceptSessionId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        and(
          eq(sessions.subjectType, realm),
          eq(sessions.subjectId, subjectId),
          eq(sessions.deviceLabel, deviceLabel),
          ne(sessions.id, exceptSessionId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  async activeTokenHashes(tx: Tx, realm: Realm, subjectId: string): Promise<Buffer[]> {
    const rows = await tx
      .select({ tokenHash: sessions.tokenHash })
      .from(sessions)
      .where(
        and(
          eq(sessions.subjectType, realm),
          eq(sessions.subjectId, subjectId),
          isNull(sessions.revokedAt),
        ),
      );
    return rows.map((r) => r.tokenHash);
  }

  /** Cleanup: sessions that ended (expired or revoked) before `before`. */
  async deleteEndedBefore(tx: Tx, before: Date): Promise<number> {
    const rows = await tx
      .delete(sessions)
      .where(or(lt(sessions.absoluteExpiresAt, before), lt(sessions.revokedAt, before)))
      .returning({ id: sessions.id });
    return rows.length;
  }

  /** Marks expired-but-unrevoked sessions so lists and audits show why they ended. */
  async markExpired(tx: Tx, now: Date): Promise<number> {
    const rows = await tx
      .update(sessions)
      .set({ revokedAt: now, revokeReason: 'expired' })
      .where(
        and(
          isNull(sessions.revokedAt),
          or(lt(sessions.idleExpiresAt, now), lt(sessions.absoluteExpiresAt, now)),
        ),
      )
      .returning({ id: sessions.id });
    return rows.length;
  }
}
