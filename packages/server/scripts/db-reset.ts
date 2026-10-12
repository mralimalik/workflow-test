import { Pool } from 'pg';

import { loadScriptEnv, redactUrl } from './lib/env';
import { runMigrations } from './lib/migrate';

/** Drops and rebuilds the local database schema. Refuses to run outside local/test. */
async function main(): Promise<void> {
  const env = loadScriptEnv();
  const host = new URL(env.DATABASE_MIGRATION_URL).hostname;
  const isLocalHost = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(host);
  if (env.APP_ENV !== 'local' || env.NODE_ENV === 'production' || !isLocalHost) {
    console.error(
      `Refusing to reset ${redactUrl(env.DATABASE_MIGRATION_URL)} (APP_ENV=${env.APP_ENV}, NODE_ENV=${env.NODE_ENV}). ` +
        'db:reset only runs against a local database.',
    );
    process.exit(1);
  }

  const pool = new Pool({ connectionString: env.DATABASE_MIGRATION_URL, max: 1 });
  try {
    console.log(`Resetting ${redactUrl(env.DATABASE_MIGRATION_URL)}`);
    await pool.query('DROP SCHEMA IF EXISTS drizzle CASCADE');
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
    await pool.query('CREATE SCHEMA public');
  } finally {
    await pool.end();
  }
  await runMigrations(env.DATABASE_MIGRATION_URL);
  console.log('Database reset and migrated. Run `pnpm db:seed` to seed.');
}

main().catch((error: unknown) => {
  console.error('Reset failed:', error);
  process.exit(1);
});
