import fs from 'node:fs';
import path from 'node:path';

import { Client } from 'pg';

import { runMigrations } from '../packages/server/scripts/lib/migrate';
import { runSeeds } from '../packages/server/scripts/lib/seed';
import { databaseOf, requireEnv, templateName, testDatabasePrefix, withDatabase } from './db-urls';

/**
 * Integration/e2e global setup (plan §1): build a template database from the migrations
 * once per run. Each test file then clones it (test/db-per-file.ts) — real Postgres, full
 * isolation, no shared state between files.
 */
export default async function setup(): Promise<void> {
  const envFile = path.resolve(import.meta.dirname, '../.env');
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

  const ownerUrl = requireEnv('DATABASE_MIGRATION_URL');
  const base = databaseOf(ownerUrl);
  const template = templateName(base);
  const admin = new Client({ connectionString: withDatabase(ownerUrl, 'postgres') });
  await admin.connect();
  try {
    // Leftovers from interrupted runs.
    const { rows } = await admin.query<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE $1 OR datname = $2`,
      [`${testDatabasePrefix(base)}%`, template],
    );
    for (const { datname } of rows)
      await admin.query(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${template}"`);
  } finally {
    await admin.end();
  }
  await runMigrations(withDatabase(ownerUrl, template));
  // Platform reference data (templates, plans, roles) is part of every database.
  await runSeeds(withDatabase(ownerUrl, template), 'local');
}
