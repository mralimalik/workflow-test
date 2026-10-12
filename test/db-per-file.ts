import { randomBytes } from 'node:crypto';

import { Client } from 'pg';
import { afterAll } from 'vitest';

import { databaseOf, requireEnv, templateName, testDatabasePrefix, withDatabase } from './db-urls';

/**
 * Runs before each integration/e2e test file: clones the migrated template into a fresh
 * database and points DATABASE_URL / DATABASE_MIGRATION_URL at it; drops it afterwards.
 */
const ownerUrl = requireEnv('DATABASE_MIGRATION_URL');
const appUrl = requireEnv('DATABASE_URL');
const base = databaseOf(ownerUrl);
const database = `${testDatabasePrefix(base)}${randomBytes(6).toString('hex')}`;

async function admin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: withDatabase(ownerUrl, 'postgres') });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

await admin((c) => c.query(`CREATE DATABASE "${database}" TEMPLATE "${templateName(base)}"`));
process.env['DATABASE_MIGRATION_URL'] = withDatabase(ownerUrl, database);
process.env['DATABASE_URL'] = withDatabase(appUrl, database);

afterAll(async () => {
  await admin((c) => c.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`));
});
