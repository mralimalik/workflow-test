import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

import { CacheService, defineCacheNamespace } from '../../../kernel/cache/cache.service';
import { Database } from '../../../kernel/db/database';
import { Clock } from '../../../kernel/time/clock';
import { evaluateFlag, type FlagContext } from '../domain/evaluate';
import { featureFlagOverrides, featureFlags } from '../infrastructure/feature-flags.schema';

const snapshotSchema = z.array(
  z.object({
    key: z.string(),
    defaultValue: z.unknown(),
    rolloutPercent: z.int(),
    isArchived: z.boolean(),
    overrides: z.array(
      z.object({
        scopeType: z.enum(['plan', 'organization', 'location', 'user']),
        scopeId: z.string(),
        value: z.unknown(),
        expiresAt: z.string().nullable(),
      }),
    ),
  }),
);
type Snapshot = z.infer<typeof snapshotSchema>;

/** Cache catalogue: `feature-flags` (global), 5 min, invalidated by `feature_flag.*` (BACKEND.md §9.2). */
export const FEATURE_FLAGS_CACHE = defineCacheNamespace({
  name: 'feature-flags',
  ttlSeconds: 300,
  schema: snapshotSchema,
});

/** Evaluates feature flags from a cached snapshot of all flags and overrides. */
@Injectable()
export class FeatureFlags {
  private readonly logger = new Logger(FeatureFlags.name);

  constructor(
    private readonly db: Database,
    private readonly cache: CacheService,
    private readonly clock: Clock,
  ) {}

  /** Boolean flag; unknown keys are off (and logged, since that is usually a typo). */
  async isEnabled(key: string, ctx: FlagContext = {}): Promise<boolean> {
    return (await this.value(key, ctx)) === true;
  }

  async value(key: string, ctx: FlagContext = {}): Promise<unknown> {
    const flag = (await this.snapshot()).find((f) => f.key === key);
    if (!flag) {
      this.logger.warn({ flag: key }, 'Unknown feature flag');
      return undefined;
    }
    return evaluateFlag(flag, flag.overrides, ctx, this.clock.now());
  }

  private snapshot(): Promise<Snapshot> {
    return this.cache.getOrLoad(FEATURE_FLAGS_CACHE, ['global'], () => this.load());
  }

  private load(): Promise<Snapshot> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .select({
          key: featureFlags.key,
          defaultValue: featureFlags.defaultValue,
          rolloutPercent: featureFlags.rolloutPercent,
          isArchived: featureFlags.isArchived,
          scopeType: featureFlagOverrides.scopeType,
          scopeId: featureFlagOverrides.scopeId,
          value: featureFlagOverrides.value,
          expiresAt: featureFlagOverrides.expiresAt,
        })
        .from(featureFlags)
        .leftJoin(featureFlagOverrides, eq(featureFlagOverrides.featureFlagId, featureFlags.id));
      const byKey = new Map<string, Snapshot[number]>();
      for (const r of rows) {
        const entry = byKey.get(r.key) ?? {
          key: r.key,
          defaultValue: r.defaultValue,
          rolloutPercent: r.rolloutPercent,
          isArchived: r.isArchived,
          overrides: [],
        };
        if (r.scopeType && r.scopeId) {
          entry.overrides.push({
            scopeType: r.scopeType,
            scopeId: r.scopeId,
            value: r.value,
            expiresAt: r.expiresAt?.toISOString() ?? null,
          });
        }
        byKey.set(r.key, entry);
      }
      return [...byKey.values()];
    });
  }
}
