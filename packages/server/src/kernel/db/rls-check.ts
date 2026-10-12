import type { Pool } from 'pg';

export interface RlsViolation {
  table: string;
  problems: string[];
}

/**
 * Every table in `public` with an `organization_id` column must have RLS enabled, forced,
 * and a `tenant_isolation` policy (BACKEND.md §13). Run after migrations in CI
 * (`pnpm db:check-rls`) and in the integration suite.
 */
export async function findRlsViolations(pool: Pool, schema = 'public'): Promise<RlsViolation[]> {
  const { rows } = await pool.query<{
    table: string;
    enabled: boolean;
    forced: boolean;
    has_policy: boolean;
  }>(
    `SELECT c.relname AS table,
            c.relrowsecurity AS enabled,
            c.relforcerowsecurity AS forced,
            EXISTS (SELECT 1 FROM pg_policies p
                     WHERE p.schemaname = n.nspname AND p.tablename = c.relname
                       AND p.policyname = 'tenant_isolation') AS has_policy
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relkind IN ('r', 'p')
        AND NOT c.relispartition
        AND EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped)
      ORDER BY c.relname`,
    [schema],
  );
  return rows
    .map((r) => ({
      table: r.table,
      problems: [
        ...(r.enabled ? [] : ['RLS not enabled']),
        ...(r.forced ? [] : ['RLS not forced']),
        ...(r.has_policy ? [] : ['no tenant_isolation policy']),
      ],
    }))
    .filter((v) => v.problems.length > 0);
}
