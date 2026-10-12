import { sql, type SQL } from 'drizzle-orm';
import { pgPolicy, type PgPolicy } from 'drizzle-orm/pg-core';

/** Session settings used by RLS policies; set with `SET LOCAL` semantics per transaction. */
export const RLS_SETTINGS = {
  organizationId: 'app.organization_id',
  customerId: 'app.customer_id',
  actorType: 'app.actor_type',
  actorId: 'app.actor_id',
  scope: 'app.scope',
} as const;

/** The current tenant, or NULL when unset (so policies fail closed). */
export const currentOrganizationId: SQL = sql`nullif(current_setting('app.organization_id', true), '')::uuid`;
export const currentCustomerId: SQL = sql`nullif(current_setting('app.customer_id', true), '')::uuid`;

/**
 * Drizzle policy declarations for a tenant table (BACKEND.md §7.2), used in the table's
 * extra config together with `.enableRLS()`. drizzle-kit generates ENABLE + CREATE POLICY;
 * FORCE is added with {@link forceRlsSql} in the same migration (Drizzle cannot express
 * it). `pnpm db:check-rls` fails if any of the three is missing.
 */
export function tenantPolicies(options: { customerRead?: boolean } = {}): PgPolicy[] {
  const policies = [
    pgPolicy('tenant_isolation', {
      for: 'all',
      using: sql`organization_id = ${currentOrganizationId}`,
      withCheck: sql`organization_id = ${currentOrganizationId}`,
    }),
  ];
  if (options.customerRead) {
    policies.push(
      pgPolicy('customer_read_own', {
        for: 'select',
        using: sql`customer_id = ${currentCustomerId}`,
      }),
    );
  }
  return policies;
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

/** `ALTER TABLE … FORCE ROW LEVEL SECURITY` — append to the migration that creates the table. */
export function forceRlsSql(table: string): string {
  return `ALTER TABLE ${quoteIdent(table)} FORCE ROW LEVEL SECURITY;`;
}

/**
 * Complete RLS SQL for a tenant table, for hand-written migrations and tests: enable,
 * force, `tenant_isolation`, and optionally `customer_read_own`.
 */
export function tenantRlsSql(table: string, options: { customerRead?: boolean } = {}): string {
  const t = quoteIdent(table);
  const org = "nullif(current_setting('app.organization_id', true), '')::uuid";
  const lines = [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY "tenant_isolation" ON ${t} AS PERMISSIVE FOR ALL TO public USING (organization_id = ${org}) WITH CHECK (organization_id = ${org});`,
  ];
  if (options.customerRead) {
    lines.push(
      `CREATE POLICY "customer_read_own" ON ${t} AS PERMISSIVE FOR SELECT TO public USING (customer_id = nullif(current_setting('app.customer_id', true), '')::uuid);`,
    );
  }
  return lines.join('\n');
}
