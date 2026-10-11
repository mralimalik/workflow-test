import { Redis } from 'ioredis';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Verifies the local/CI infrastructure contract that every later integration test relies on
 * (README → Local development, BACKEND.md §7): Postgres 17 with the required extensions,
 * a runtime role that cannot bypass RLS, migrations applied, Redis configured for BullMQ.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — copy .env.example to .env`);
  return value;
}

describe('infrastructure', () => {
  let app: Pool;
  let redis: Redis;

  beforeAll(() => {
    app = new Pool({ connectionString: requireEnv('DATABASE_URL'), max: 1 });
    redis = new Redis(requireEnv('REDIS_QUEUE_URL'), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
  });

  afterAll(async () => {
    await app.end();
    redis.disconnect();
  });

  it('runs PostgreSQL 17+', async () => {
    const { rows } = await app.query<{ v: number }>(
      "SELECT current_setting('server_version_num')::int AS v",
    );
    expect(rows[0]!.v).toBeGreaterThanOrEqual(170000);
  });

  it('has citext, btree_gist and vector installed', async () => {
    const { rows } = await app.query<{ extname: string }>('SELECT extname FROM pg_extension');
    expect(rows.map((r) => r.extname)).toEqual(
      expect.arrayContaining(['citext', 'btree_gist', 'vector']),
    );
  });

  it('NFR-SEC: connects as attendra_app, which is neither superuser nor BYPASSRLS', async () => {
    const { rows } = await app.query<{ user: string; rolsuper: boolean; rolbypassrls: boolean }>(
      'SELECT current_user AS user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
    );
    expect(rows[0]).toEqual({ user: 'attendra_app', rolsuper: false, rolbypassrls: false });
  });

  it('has the baseline migration applied', async () => {
    const { rows } = await app.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_namespace WHERE nspname = 'drizzle'",
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('Redis uses maxmemory-policy noeviction (required by BullMQ)', async () => {
    await redis.connect();
    const config = (await redis.config('GET', 'maxmemory-policy')) as string[];
    expect(config[1]).toBe('noeviction');
  });
});
