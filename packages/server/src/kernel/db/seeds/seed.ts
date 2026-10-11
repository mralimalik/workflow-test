import type { Pool } from 'pg';

/**
 * An idempotent seed. Running it twice must leave the database unchanged the second time
 * (upsert by natural key). `environments` limits where it may run, e.g. the demo tenant is
 * local-only.
 */
export interface Seed {
  readonly name: string;
  readonly environments: readonly ('local' | 'dev' | 'staging' | 'production')[];
  run(pool: Pool): Promise<void>;
}
