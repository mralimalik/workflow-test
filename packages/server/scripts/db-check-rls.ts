import { Pool } from 'pg';

import { findRlsViolations } from '../src/kernel/db/rls-check';
import { loadScriptEnv } from './lib/env';

/** CI gate: every tenant table must have RLS enabled, forced, and tenant_isolation. */
async function main(): Promise<void> {
  const env = loadScriptEnv();
  const pool = new Pool({ connectionString: env.DATABASE_MIGRATION_URL, max: 1 });
  try {
    const violations = await findRlsViolations(pool);
    if (violations.length === 0) {
      console.log(
        'RLS check passed: every tenant table has RLS enabled, forced, and tenant_isolation.',
      );
      return;
    }
    for (const v of violations) console.error(`✘ ${v.table}: ${v.problems.join(', ')}`);
    console.error('Add RLS in the migration (see kernel/db/rls.ts and BACKEND.md §7.2).');
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
