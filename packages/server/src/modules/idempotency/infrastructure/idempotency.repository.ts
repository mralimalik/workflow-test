import { Injectable } from '@nestjs/common';
import { and, eq, lt, sql } from 'drizzle-orm';

import { Database } from '../../../kernel/db/database';
import { newId } from '../../../kernel/ids/ids';
import { idempotencyKeys, type IdempotencyKeyRow } from './idempotency.schema';

const TTL_MS = 24 * 3600 * 1000;

@Injectable()
export class IdempotencyRepository {
  constructor(private readonly db: Database) {}

  /** Claims `(scope, key)`. Returns the existing row when it was already claimed. */
  async claim(
    scope: string,
    key: string,
    requestHash: Buffer,
    now: Date,
  ): Promise<{ claimed: true } | { claimed: false; existing: IdempotencyKeyRow }> {
    return this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(idempotencyKeys)
        .values({
          id: newId(),
          scope,
          key,
          requestHash,
          expiresAt: new Date(now.getTime() + TTL_MS),
        })
        .onConflictDoNothing({ target: [idempotencyKeys.scope, idempotencyKeys.key] })
        .returning({ id: idempotencyKeys.id });
      if (inserted.length > 0) return { claimed: true as const };
      const [existing] = await tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
      if (!existing) throw new Error('Idempotency key vanished between insert and select');
      if (existing.expiresAt < now) {
        // Expired but not yet cleaned up: take it over.
        await tx
          .update(idempotencyKeys)
          .set({
            requestHash,
            status: 'in_progress',
            responseStatus: null,
            responseBody: null,
            expiresAt: new Date(now.getTime() + TTL_MS),
          })
          .where(eq(idempotencyKeys.id, existing.id));
        return { claimed: true as const };
      }
      return { claimed: false as const, existing };
    });
  }

  async complete(scope: string, key: string, status: number, body: unknown): Promise<void> {
    await this.db.transaction((tx) =>
      tx
        .update(idempotencyKeys)
        .set({ status: 'completed', responseStatus: status, responseBody: body ?? null })
        .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key))),
    );
  }

  /** Frees a key whose request failed, so the client may retry with it. */
  async release(scope: string, key: string): Promise<void> {
    await this.db.transaction((tx) =>
      tx
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.scope, scope),
            eq(idempotencyKeys.key, key),
            eq(idempotencyKeys.status, 'in_progress'),
          ),
        ),
    );
  }

  /** Nightly cleanup; returns the number of rows removed. */
  async deleteExpired(now: Date): Promise<number> {
    const result = await this.db.transaction((tx) =>
      tx.execute(sql`delete from ${idempotencyKeys} where ${lt(idempotencyKeys.expiresAt, now)}`),
    );
    return result.rowCount ?? 0;
  }
}
