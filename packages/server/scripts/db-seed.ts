import { Pool } from 'pg';

import { seeds } from '../src/kernel/db/seeds/registry';
import { loadScriptEnv } from './lib/env';

async function main(): Promise<void> {
  const env = loadScriptEnv();
  const applicable = seeds.filter((s) => s.environments.includes(env.APP_ENV));
  if (applicable.length === 0) {
    console.log(`No seeds registered for APP_ENV=${env.APP_ENV}.`);
    return;
  }
  const pool = new Pool({ connectionString: env.DATABASE_MIGRATION_URL, max: 1 });
  try {
    for (const seed of applicable) {
      console.log(`Seeding ${seed.name}…`);
      await seed.run(pool);
    }
  } finally {
    await pool.end();
  }
  console.log(`Applied ${applicable.length} seed(s).`);
}

main().catch((error: unknown) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
