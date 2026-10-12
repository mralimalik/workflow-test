import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';

import type { Tx } from '../../../kernel/db/database';
import { mfaFactors, type MfaFactorRow } from './auth.schema';

export type MfaSubjectType = 'user' | 'platform_admin';
export type NewMfaFactor = typeof mfaFactors.$inferInsert;

/** Persistence for `mfa_factors` (data model 01). */
@Injectable()
export class MfaRepository {
  async insert(tx: Tx, row: NewMfaFactor): Promise<MfaFactorRow> {
    const [created] = await tx.insert(mfaFactors).values(row).returning();
    if (!created) throw new Error('insert returned no row');
    return created;
  }

  async findActive(
    tx: Tx,
    subjectType: MfaSubjectType,
    subjectId: string,
    type: MfaFactorRow['type'],
    options: { forUpdate?: boolean } = {},
  ): Promise<MfaFactorRow | null> {
    const query = tx
      .select()
      .from(mfaFactors)
      .where(
        and(
          eq(mfaFactors.subjectType, subjectType),
          eq(mfaFactors.subjectId, subjectId),
          eq(mfaFactors.type, type),
          isNotNull(mfaFactors.verifiedAt),
        ),
      );
    const [row] = options.forUpdate ? await query.for('update') : await query;
    return row ?? null;
  }

  /** Which of these subjects have an active TOTP factor (one query for list pages). */
  async withActiveTotp(
    tx: Tx,
    subjectType: MfaSubjectType,
    subjectIds: readonly string[],
  ): Promise<Set<string>> {
    if (subjectIds.length === 0) return new Set();
    const rows = await tx
      .select({ subjectId: mfaFactors.subjectId })
      .from(mfaFactors)
      .where(
        and(
          eq(mfaFactors.subjectType, subjectType),
          inArray(mfaFactors.subjectId, [...subjectIds]),
          eq(mfaFactors.type, 'totp'),
          isNotNull(mfaFactors.verifiedAt),
        ),
      );
    return new Set(rows.map((r) => r.subjectId));
  }

  /** The newest TOTP factor awaiting confirmation. */
  async findPendingTotp(
    tx: Tx,
    subjectType: MfaSubjectType,
    subjectId: string,
  ): Promise<MfaFactorRow | null> {
    const [row] = await tx
      .select()
      .from(mfaFactors)
      .where(
        and(
          eq(mfaFactors.subjectType, subjectType),
          eq(mfaFactors.subjectId, subjectId),
          eq(mfaFactors.type, 'totp'),
          isNull(mfaFactors.verifiedAt),
        ),
      )
      .orderBy(desc(mfaFactors.createdAt))
      .limit(1)
      .for('update');
    return row ?? null;
  }

  async update(tx: Tx, id: string, changes: Partial<NewMfaFactor>): Promise<void> {
    await tx.update(mfaFactors).set(changes).where(eq(mfaFactors.id, id));
  }

  /**
   * Records a TOTP use only if its time step is newer than the last one (replay protection,
   * atomic under concurrency). Returns false for a replayed step.
   */
  async advanceStep(tx: Tx, id: string, step: number, at: Date): Promise<boolean> {
    const rows = await tx
      .update(mfaFactors)
      .set({ lastUsedStep: step, lastUsedAt: at })
      .where(
        and(
          eq(mfaFactors.id, id),
          or(isNull(mfaFactors.lastUsedStep), lt(mfaFactors.lastUsedStep, step)),
        ),
      )
      .returning({ id: mfaFactors.id });
    return rows.length > 0;
  }

  async deleteAll(
    tx: Tx,
    subjectType: MfaSubjectType,
    subjectId: string,
    options: { onlyUnverified?: boolean; type?: MfaFactorRow['type'] } = {},
  ): Promise<number> {
    const rows = await tx
      .delete(mfaFactors)
      .where(
        and(
          eq(mfaFactors.subjectType, subjectType),
          eq(mfaFactors.subjectId, subjectId),
          options.type ? eq(mfaFactors.type, options.type) : undefined,
          options.onlyUnverified ? isNull(mfaFactors.verifiedAt) : undefined,
        ),
      )
      .returning({ id: mfaFactors.id });
    return rows.length;
  }
}
