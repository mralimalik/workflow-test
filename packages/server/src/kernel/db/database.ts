import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { Pool, type PoolConfig } from 'pg';

import type { Actor } from '../context/request-context';
import { RLS_SETTINGS } from './rls';

/** A Drizzle transaction handle; repositories take it explicitly (BACKEND.md §7.3). */
export type Tx = PgTransaction<NodePgQueryResultHKT>;

export interface TenantScope {
  organizationId: string;
  actor: Actor;
}

export interface PlatformScope {
  actor: Actor;
  /** Why platform-wide access is needed; recorded in logs and (A3) the audit log. */
  reason: string;
}

export interface DatabaseOptions {
  connectionString: string;
  poolMax: number;
  /** Per-statement timeout: 5 s for the API, 60 s for workers (BACKEND.md §7.5). */
  statementTimeoutMs: number;
  applicationName: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The only way to reach the database at runtime. Connects as `attendra_app` (no RLS
 * bypass). Tenant data is reachable only inside {@link tenantTx}, which binds the
 * organization with transaction-local settings so pooled connections never leak it.
 */
@Injectable()
export class Database implements OnModuleDestroy {
  private readonly logger = new Logger(Database.name);
  readonly pool: Pool;
  private readonly db: NodePgDatabase;

  constructor(options: DatabaseOptions) {
    const config: PoolConfig = {
      connectionString: options.connectionString,
      max: options.poolMax,
      application_name: options.applicationName,
      options: `-c statement_timeout=${options.statementTimeoutMs} -c idle_in_transaction_session_timeout=${options.statementTimeoutMs * 2}`,
    };
    this.pool = new Pool(config);
    this.pool.on('error', (error) => {
      this.logger.error({ err: error }, 'Idle database client error');
    });
    this.db = drizzle({ client: this.pool });
  }

  /**
   * Runs `fn` in a transaction bound to one organization (BACKEND.md §7.3). RLS limits
   * every statement to that organization's rows.
   */
  async tenantTx<T>(scope: TenantScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    if (!UUID.test(scope.organizationId)) throw new Error('tenantTx requires an organization UUID');
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config(${RLS_SETTINGS.organizationId}, ${scope.organizationId}, true),
                   set_config(${RLS_SETTINGS.actorType}, ${scope.actor.type}, true),
                   set_config(${RLS_SETTINGS.actorId}, ${scope.actor.id}, true)`,
      );
      return fn(tx as unknown as Tx);
    });
  }

  /**
   * Platform-scope work that legitimately spans tenants (BACKEND.md §7.2): sets
   * `app.scope = 'platform'`, which only dedicated policies honour. Always logged.
   */
  async platformTx<T>(scope: PlatformScope, fn: (tx: Tx) => Promise<T>): Promise<T> {
    this.logger.log({ actor: scope.actor, reason: scope.reason }, 'Platform-scope transaction');
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config(${RLS_SETTINGS.scope}, 'platform', true),
                   set_config(${RLS_SETTINGS.actorType}, ${scope.actor.type}, true),
                   set_config(${RLS_SETTINGS.actorId}, ${scope.actor.id}, true)`,
      );
      return fn(tx as unknown as Tx);
    });
  }

  /**
   * A transaction on global (non-tenant) tables — users, sessions, plans… RLS still
   * applies, so tenant tables return no rows here.
   */
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(tx as unknown as Tx));
  }

  /** Readiness probe. */
  async ping(): Promise<void> {
    await this.pool.query('select 1');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
