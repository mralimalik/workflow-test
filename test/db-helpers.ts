import { Pool } from 'pg';

/**
 * Truncates every table in `public` (owner role), for tests that share one database across
 * cases. Per-file databases (db-per-file.ts) already isolate files from each other.
 */
export async function truncateAll(
  ownerUrl = process.env['DATABASE_MIGRATION_URL']!,
): Promise<void> {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    const { rows } = await pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    if (rows.length > 0) {
      await pool.query(
        `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
      );
    }
  } finally {
    await pool.end();
  }
}
