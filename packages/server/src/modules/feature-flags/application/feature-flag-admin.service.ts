import { featureFlagChanged } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt } from 'drizzle-orm';

import type { Actor } from '../../../kernel/context/request-context';
import type { Tx } from '../../../kernel/db/database';
import { mapDbError } from '../../../kernel/db/db-errors';
import { NotFoundError, ValidationError } from '../../../kernel/errors/app-error';
import { newId } from '../../../kernel/ids/ids';
import { AuditService } from '../../audit/audit.public';
import { OutboxWriter } from '../../outbox/outbox.public';
import {
  FLAG_TYPES,
  featureFlagOverrides,
  featureFlags,
  OVERRIDE_SCOPES,
} from '../infrastructure/feature-flags.schema';

export type FlagRow = typeof featureFlags.$inferSelect;
export type OverrideRow = typeof featureFlagOverrides.$inferSelect;
type FlagType = (typeof FLAG_TYPES)[number];

/** A value must match the flag's declared type (data model 14 `feature_flags.type`). */
function assertValueType(type: FlagType, value: unknown, path: string): void {
  const ok =
    type === 'boolean'
      ? typeof value === 'boolean'
      : type === 'string'
        ? typeof value === 'string'
        : type === 'number'
          ? typeof value === 'number' && Number.isFinite(value)
          : value !== undefined;
  if (!ok) {
    throw new ValidationError([
      { path, code: 'invalid_type', message: `Expected a ${type} value for this flag` },
    ]);
  }
}

/**
 * Flag definitions and overrides for the admin console (FR-ADM-005). Every change is
 * audited and emits `feature_flag.changed`, which invalidates the evaluation cache.
 * Runs in the caller's transaction.
 */
@Injectable()
export class FeatureFlagAdmin {
  constructor(
    private readonly outbox: OutboxWriter,
    private readonly audit: AuditService,
  ) {}

  /** Ordered by key; keyset on key. */
  async list(
    tx: Tx,
    page: { limit: number; afterKey?: string | undefined; includeArchived: boolean },
  ): Promise<FlagRow[]> {
    return tx
      .select()
      .from(featureFlags)
      .where(
        and(
          page.includeArchived ? undefined : eq(featureFlags.isArchived, false),
          page.afterKey ? gt(featureFlags.key, page.afterKey) : undefined,
        ),
      )
      .orderBy(asc(featureFlags.key))
      .limit(page.limit);
  }

  async get(tx: Tx, id: string): Promise<FlagRow> {
    const [row] = await tx.select().from(featureFlags).where(eq(featureFlags.id, id));
    if (!row) throw new NotFoundError();
    return row;
  }

  async create(
    tx: Tx,
    actor: Actor,
    input: {
      key: string;
      description: string;
      type: FlagType;
      defaultValue: unknown;
      rolloutPercent: number;
    },
  ): Promise<FlagRow> {
    assertValueType(input.type, input.defaultValue, 'defaultValue');
    try {
      const [row] = await tx
        .insert(featureFlags)
        .values({ id: newId(), ...input })
        .returning();
      if (!row) throw new Error('insert returned no row');
      await this.changed(tx, actor, row, 'feature_flag.created', {});
      return row;
    } catch (error) {
      throw mapDbError(error, { feature_flags_key_uq: 'conflict' });
    }
  }

  async update(
    tx: Tx,
    actor: Actor,
    id: string,
    changes: {
      description?: string | undefined;
      defaultValue?: unknown;
      rolloutPercent?: number | undefined;
      isArchived?: boolean | undefined;
    },
  ): Promise<FlagRow> {
    const before = await this.get(tx, id);
    if (changes.defaultValue !== undefined) {
      assertValueType(before.type, changes.defaultValue, 'defaultValue');
    }
    const [after] = await tx
      .update(featureFlags)
      .set(changes)
      .where(eq(featureFlags.id, id))
      .returning();
    if (!after) throw new NotFoundError();
    const diff = Object.fromEntries(
      (Object.keys(changes) as (keyof typeof changes)[])
        .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
        .map((k) => [k, [before[k], after[k]] as [unknown, unknown]]),
    );
    await this.changed(tx, actor, after, 'feature_flag.updated', diff);
    return after;
  }

  async listOverrides(tx: Tx, flagId: string): Promise<OverrideRow[]> {
    await this.get(tx, flagId);
    return tx
      .select()
      .from(featureFlagOverrides)
      .where(eq(featureFlagOverrides.featureFlagId, flagId))
      .orderBy(asc(featureFlagOverrides.scopeType), asc(featureFlagOverrides.createdAt));
  }

  /** Upsert by (flag, scope). */
  async setOverride(
    tx: Tx,
    actor: Actor,
    flagId: string,
    input: {
      scopeType: (typeof OVERRIDE_SCOPES)[number];
      scopeId: string;
      value: unknown;
      expiresAt: Date | null;
    },
  ): Promise<OverrideRow> {
    const flag = await this.get(tx, flagId);
    assertValueType(flag.type, input.value, 'value');
    const setBy = actor.type === 'platform_admin' ? actor.id : null;
    const [row] = await tx
      .insert(featureFlagOverrides)
      .values({ id: newId(), featureFlagId: flagId, ...input, setByPlatformAdminId: setBy })
      .onConflictDoUpdate({
        target: [
          featureFlagOverrides.featureFlagId,
          featureFlagOverrides.scopeType,
          featureFlagOverrides.scopeId,
        ],
        set: { value: input.value, expiresAt: input.expiresAt, setByPlatformAdminId: setBy },
      })
      .returning();
    if (!row) throw new Error('upsert returned no row');
    await this.changed(tx, actor, flag, 'feature_flag.override_set', {
      [`${input.scopeType}:${input.scopeId}`]: [null, input.value],
    });
    return row;
  }

  async deleteOverride(tx: Tx, actor: Actor, flagId: string, overrideId: string): Promise<void> {
    const flag = await this.get(tx, flagId);
    const [row] = await tx
      .delete(featureFlagOverrides)
      .where(
        and(
          eq(featureFlagOverrides.id, overrideId),
          eq(featureFlagOverrides.featureFlagId, flagId),
        ),
      )
      .returning();
    if (!row) throw new NotFoundError();
    await this.changed(tx, actor, flag, 'feature_flag.override_removed', {
      [`${row.scopeType}:${row.scopeId}`]: [row.value, null],
    });
  }

  private async changed(
    tx: Tx,
    actor: Actor,
    flag: FlagRow,
    action: string,
    changes: Record<string, [unknown, unknown]>,
  ): Promise<void> {
    await this.outbox.write(tx, featureFlagChanged, {
      aggregateId: flag.id,
      organizationId: null,
      actor,
      data: { key: flag.key },
    });
    await this.audit.record(tx, {
      action,
      actor,
      target: { type: 'feature_flag', id: flag.id },
      changes,
      context: { key: flag.key },
    });
  }
}
