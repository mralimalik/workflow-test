import type { Realm } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, lt, ne } from 'drizzle-orm';

import type { Tx } from '../../../kernel/db/database';
import { authChallenges, type ChallengePurpose, type ChallengeRow } from './auth.schema';

export type NewChallenge = typeof authChallenges.$inferInsert;

/** Persistence for `auth_challenges` (data model 01). */
@Injectable()
export class ChallengesRepository {
  async insert(tx: Tx, row: NewChallenge): Promise<ChallengeRow> {
    const [created] = await tx.insert(authChallenges).values(row).returning();
    if (!created) throw new Error('insert returned no row');
    return created;
  }

  /**
   * Consumes an open link challenge atomically (single use): one conditional UPDATE, so two
   * concurrent uses of the same link cannot both succeed.
   */
  async consumeLink(
    tx: Tx,
    input: { realm: Realm; purpose: ChallengePurpose; secretHash: Buffer; now: Date },
  ): Promise<ChallengeRow | null> {
    const [row] = await tx
      .update(authChallenges)
      .set({ consumedAt: input.now, attempts: 1 })
      .where(
        and(
          eq(authChallenges.secretHash, input.secretHash),
          eq(authChallenges.kind, 'link'),
          eq(authChallenges.realm, input.realm),
          eq(authChallenges.purpose, input.purpose),
          isNull(authChallenges.consumedAt),
          gt(authChallenges.expiresAt, input.now),
        ),
      )
      .returning();
    return row ?? null;
  }

  /** Closes the subject's other open challenges for a purpose (older reset links die). */
  async closeOthers(
    tx: Tx,
    input: {
      realm: Realm;
      subjectId: string;
      purpose: ChallengePurpose;
      exceptId: string;
      now: Date;
    },
  ): Promise<void> {
    await tx
      .update(authChallenges)
      .set({ consumedAt: input.now })
      .where(
        and(
          eq(authChallenges.realm, input.realm),
          eq(authChallenges.subjectId, input.subjectId),
          eq(authChallenges.purpose, input.purpose),
          isNull(authChallenges.consumedAt),
          ne(authChallenges.id, input.exceptId),
        ),
      );
  }

  async deleteExpiredBefore(tx: Tx, before: Date): Promise<number> {
    const rows = await tx
      .delete(authChallenges)
      .where(lt(authChallenges.expiresAt, before))
      .returning({ id: authChallenges.id });
    return rows.length;
  }
}
