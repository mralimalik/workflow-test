import { loadScriptEnv } from './lib/env';
import { runSeeds } from './lib/seed';

async function main(): Promise<void> {
  const env = loadScriptEnv();
  const applied = await runSeeds(env.DATABASE_MIGRATION_URL, env.APP_ENV);
  console.log(
    applied.length
      ? `Applied seeds: ${applied.join(', ')}`
      : `No seeds registered for APP_ENV=${env.APP_ENV}.`,
  );
}

main().catch((error: unknown) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
