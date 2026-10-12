import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit generates SQL from module schemas; generated SQL is reviewed and hand-edited
 * where needed (RLS, exclusion constraints) — BACKEND.md §13. Migrations run as the owner role.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/*/infrastructure/*.schema.ts',
  out: './migrations',
  dbCredentials: {
    url: process.env['DATABASE_MIGRATION_URL'] ?? '',
  },
  migrations: {
    schema: 'drizzle',
    table: '__drizzle_migrations',
  },
  strict: true,
  verbose: true,
});
