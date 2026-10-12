import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConflictError, NotFoundError, ValidationError } from '../errors/app-error';
import { newId } from '../ids/ids';
import { Database } from './database';
import { mapDbError, pgErrorOf } from './db-errors';
import { tenantRlsSql } from './rls';
import { findRlsViolations } from './rls-check';

/**
 * A2 · tenant isolation at the database level (BACKEND.md §7, NFR-SEC). Uses a probe table
 * created with the same RLS SQL generator migrations use; the app connects as
 * attendra_app, which cannot bypass RLS.
 */
const orgA = newId();
const orgB = newId();
const user = { type: 'user', id: newId() } as const;

let owner: Pool;
let db: Database;

function appDatabase(poolMax = 4): Database {
  return new Database({
    connectionString: process.env['DATABASE_URL']!,
    poolMax,
    statementTimeoutMs: 5_000,
    applicationName: 'tenancy-test',
  });
}

async function names(tx: Parameters<Parameters<Database['transaction']>[0]>[0]): Promise<string[]> {
  const { rows } = await tx.execute<{ name: string }>(
    sql`select name from rls_probe order by name`,
  );
  return rows.map((r) => r.name);
}

beforeAll(async () => {
  owner = new Pool({ connectionString: process.env['DATABASE_MIGRATION_URL']!, max: 2 });
  await owner.query(`
    CREATE TABLE rls_probe (
      id uuid PRIMARY KEY,
      organization_id uuid NOT NULL,
      customer_id uuid,
      name text NOT NULL CHECK (length(name) > 0),
      CONSTRAINT rls_probe_org_name_uq UNIQUE (organization_id, name)
    );
    ${tenantRlsSql('rls_probe', { customerRead: true })}
  `);
  db = appDatabase();
});

afterAll(async () => {
  await db.onModuleDestroy();
  await owner.end();
});

beforeEach(async () => {
  await owner.query('TRUNCATE rls_probe');
  await owner.query(
    `INSERT INTO rls_probe (id, organization_id, name) VALUES ($1, $2, 'a1'), ($3, $2, 'a2'), ($4, $5, 'b1')`,
    [newId(), orgA, newId(), newId(), orgB],
  );
});

describe('NFR-SEC row-level security fails closed', () => {
  it('a query without tenant context returns 0 rows', async () => {
    expect(await db.transaction(names)).toEqual([]);
    const { rows } = await db.pool.query('select * from rls_probe');
    expect(rows).toEqual([]);
  });

  it('tenantTx sees only its own organization', async () => {
    expect(await db.tenantTx({ organizationId: orgA, actor: user }, names)).toEqual(['a1', 'a2']);
    expect(await db.tenantTx({ organizationId: orgB, actor: user }, names)).toEqual(['b1']);
  });

  it("an insert with another organization's id fails, and maps to 404", async () => {
    const error = await db
      .tenantTx({ organizationId: orgA, actor: user }, (tx) =>
        tx.execute(
          sql`insert into rls_probe (id, organization_id, name) values (${newId()}, ${orgB}, 'x')`,
        ),
      )
      .catch((e: unknown) => e);
    expect(pgErrorOf(error)?.code).toBe('42501');
    expect(mapDbError(error)).toBeInstanceOf(NotFoundError);
  });

  it('a row cannot be moved to another organization, nor touched across tenants', async () => {
    const moved = await db
      .tenantTx({ organizationId: orgA, actor: user }, (tx) =>
        tx.execute(sql`update rls_probe set organization_id = ${orgB} where name = 'a1'`),
      )
      .catch((e: unknown) => e);
    expect(pgErrorOf(moved)?.code).toBe('42501');

    const deleted = await db.tenantTx({ organizationId: orgA, actor: user }, (tx) =>
      tx.execute(sql`delete from rls_probe where name = 'b1'`),
    );
    expect(deleted.rowCount).toBe(0);
    expect(await db.tenantTx({ organizationId: orgB, actor: user }, names)).toEqual(['b1']);
  });

  it('writes without tenant context are rejected', async () => {
    const error = await db
      .transaction((tx) =>
        tx.execute(
          sql`insert into rls_probe (id, organization_id, name) values (${newId()}, ${orgA}, 'x')`,
        ),
      )
      .catch((e: unknown) => e);
    expect(pgErrorOf(error)?.code).toBe('42501');
  });

  it('rolls back the whole transaction on error', async () => {
    await db
      .tenantTx({ organizationId: orgA, actor: user }, async (tx) => {
        await tx.execute(
          sql`insert into rls_probe (id, organization_id, name) values (${newId()}, ${orgA}, 'a3')`,
        );
        throw new Error('boom');
      })
      .catch(() => undefined);
    expect(await db.tenantTx({ organizationId: orgA, actor: user }, names)).toEqual(['a1', 'a2']);
  });

  it('rejects a malformed organization id before touching the database', async () => {
    await expect(
      db.tenantTx({ organizationId: "' or 1=1 --", actor: user }, names),
    ).rejects.toThrow(/UUID/);
  });

  it('customer_read_own lets a customer read only their own rows', async () => {
    const customer = newId();
    await owner.query(`UPDATE rls_probe SET customer_id = $1 WHERE name IN ('a1', 'b1')`, [
      customer,
    ]);
    const rows = await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.customer_id', ${customer}, true)`);
      return names(tx);
    });
    expect(rows).toEqual(['a1', 'b1']);
  });
});

describe('NFR-SEC pooled connections never leak tenant context', () => {
  it('a reused connection has no organization after tenantTx', async () => {
    const single = appDatabase(1);
    try {
      await single.tenantTx({ organizationId: orgA, actor: user }, names);
      const { rows } = await single.pool.query<{ org: string | null }>(
        `select nullif(current_setting('app.organization_id', true), '') as org`,
      );
      expect(rows[0]!.org).toBeNull();
      expect((await single.pool.query('select * from rls_probe')).rows).toEqual([]);
      expect(await single.transaction(names)).toEqual([]);
    } finally {
      await single.onModuleDestroy();
    }
  });

  it('concurrent tenant transactions on a small pool stay isolated', async () => {
    const small = appDatabase(2);
    try {
      const runs = Array.from({ length: 40 }, (_, i) => {
        const org = i % 2 === 0 ? orgA : orgB;
        return small
          .tenantTx({ organizationId: org, actor: user }, names)
          .then((r) => [org, r] as const);
      });
      for (const [org, rows] of await Promise.all(runs)) {
        expect(rows).toEqual(org === orgA ? ['a1', 'a2'] : ['b1']);
      }
    } finally {
      await small.onModuleDestroy();
    }
  });
});

describe('Postgres error mapping (BACKEND.md §11)', () => {
  it('maps unique, check and specific constraint violations', async () => {
    const dup = await db
      .tenantTx({ organizationId: orgA, actor: user }, (tx) =>
        tx.execute(
          sql`insert into rls_probe (id, organization_id, name) values (${newId()}, ${orgA}, 'a1')`,
        ),
      )
      .catch((e: unknown) => e);
    expect(mapDbError(dup)).toBeInstanceOf(ConflictError);
    expect(mapDbError(dup, { rls_probe_org_name_uq: 'version_mismatch' })).toMatchObject({
      code: 'version_mismatch',
    });

    const empty = await db
      .tenantTx({ organizationId: orgA, actor: user }, (tx) =>
        tx.execute(
          sql`insert into rls_probe (id, organization_id, name) values (${newId()}, ${orgA}, '')`,
        ),
      )
      .catch((e: unknown) => e);
    expect(mapDbError(empty)).toBeInstanceOf(ValidationError);
  });

  it('leaves unknown errors untouched', () => {
    const error = new Error('x');
    expect(mapDbError(error)).toBe(error);
  });
});

describe('RLS check for migrations (BACKEND.md §13)', () => {
  it('the migrated schema and the probe table pass', async () => {
    expect(await findRlsViolations(owner)).toEqual([]);
  });

  it('reports a tenant table created without RLS', async () => {
    await owner.query(`
      CREATE TABLE bad_no_rls (id uuid PRIMARY KEY, organization_id uuid NOT NULL);
      CREATE TABLE bad_not_forced (id uuid PRIMARY KEY, organization_id uuid NOT NULL);
      ALTER TABLE bad_not_forced ENABLE ROW LEVEL SECURITY;
    `);
    try {
      expect(await findRlsViolations(owner)).toEqual([
        {
          table: 'bad_no_rls',
          problems: ['RLS not enabled', 'RLS not forced', 'no tenant_isolation policy'],
        },
        { table: 'bad_not_forced', problems: ['RLS not forced', 'no tenant_isolation policy'] },
      ]);
    } finally {
      await owner.query('DROP TABLE bad_no_rls, bad_not_forced');
    }
  });
});
