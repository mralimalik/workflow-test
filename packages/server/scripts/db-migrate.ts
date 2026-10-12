import { loadScriptEnv, redactUrl } from './lib/env';
import { runMigrations } from './lib/migrate';

async function main(): Promise<void> {
  const env = loadScriptEnv();
  console.log(`Migrating ${redactUrl(env.DATABASE_MIGRATION_URL)}`);
  await runMigrations(env.DATABASE_MIGRATION_URL);
  console.log('Migrations applied.');
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
