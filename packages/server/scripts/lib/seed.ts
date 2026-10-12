import { Pool } from 'pg';

import { seeds } from '../../src/apps/seeds';

/** Runs every seed registered for `appEnv`, in order, with the owner role. */
export async function runSeeds(connectionString: string, appEnv: string): Promise<string[]> {
  const applicable = seeds.filter((s) => (s.environments as readonly string[]).includes(appEnv));
  const pool = new Pool({ connectionString, max: 1 });
  try {
    for (const seed of applicable) await seed.run(pool);
  } finally {
    await pool.end();
  }
  return applicable.map((s) => s.name);
}
