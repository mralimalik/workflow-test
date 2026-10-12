import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  Optional,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { EventEnvelope } from '@attendra/contracts';
import type { Queue } from 'bullmq';
import { Client } from 'pg';

import { AppConfig } from '../../../kernel/config/app-config';
import { QUEUES } from '../../../kernel/queue/queues';
import { EventHandlerRegistry } from '../events/event-handler-registry';
import { OUTBOX_CHANNEL } from './outbox-writer';

/** Arbitrary but fixed advisory-lock key for the single active relay. */
const LEADER_LOCK_KEY = 7_340_001;
const BATCH_SIZE = 100;
const POLL_MS = 1_000;

interface OutboxRow {
  id: string;
  created_at: Date;
  organization_id: string | null;
  location_id: string | null;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  event_version: number;
  payload: unknown;
  trace_context: { requestId?: string; traceparent?: string; actor?: EventEnvelope['actor'] };
}

export interface RelayOptions {
  /** Starts automatically on bootstrap (worker); tests drive it manually. */
  autoStart: boolean;
}

export const RELAY_OPTIONS = Symbol('RELAY_OPTIONS');

/**
 * Outbox relay (BACKEND.md §10.1), runs in the worker. One active leader (session advisory
 * lock); woken by LISTEN/NOTIFY with a 1 s poll fallback. Each batch is locked with
 * `FOR UPDATE SKIP LOCKED`, fanned out as one `events` job per (event, consumer) with a
 * deterministic job id, then marked published — so an event is delivered exactly once per
 * consumer even across relay restarts and multiple instances.
 */
@Injectable()
export class OutboxRelay implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private session: Client | undefined;
  private running = false;
  private leader = false;
  private wake: (() => void) | undefined;
  private loop: Promise<void> | undefined;

  constructor(
    private readonly config: AppConfig,
    private readonly registry: EventHandlerRegistry,
    @InjectQueue(QUEUES.events) private readonly events: Queue,
    @Optional() @Inject(RELAY_OPTIONS) private readonly options: RelayOptions = { autoStart: true },
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.autoStart) this.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    await this.session?.end().catch(() => undefined);
    this.session = undefined;
    this.leader = false;
  }

  private isRunning(): boolean {
    return this.running;
  }

  get isLeader(): boolean {
    return this.leader;
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        if (!this.leader) await this.tryBecomeLeader();
        if (this.leader) {
          let published = BATCH_SIZE;
          while (published === BATCH_SIZE && this.isRunning())
            published = await this.publishBatch();
        }
      } catch (error) {
        this.logger.error({ err: error }, 'Outbox relay iteration failed');
        await this.resetSession();
      }
      await this.sleep(this.leader ? POLL_MS : POLL_MS * 5);
    }
  }

  private async connect(): Promise<Client> {
    if (this.session) return this.session;
    const client = new Client({
      connectionString: this.config.get('DATABASE_URL', { infer: true }),
      application_name: 'attendra-outbox-relay',
    });
    client.on('error', (error) => {
      this.logger.warn({ err: error }, 'Relay connection error');
      void this.resetSession();
    });
    client.on('notification', () => this.wake?.());
    await client.connect();
    this.session = client;
    return client;
  }

  private async tryBecomeLeader(): Promise<void> {
    const client = await this.connect();
    const { rows } = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked',
      [LEADER_LOCK_KEY],
    );
    if (rows[0]?.locked) {
      this.leader = true;
      await client.query(`LISTEN ${OUTBOX_CHANNEL}`);
      this.logger.log('Outbox relay is the leader');
    }
  }

  /** Publishes up to one batch; returns how many events were published. */
  async publishBatch(): Promise<number> {
    const client = await this.connect();
    await client.query('BEGIN');
    try {
      await client.query(`select set_config('app.scope', 'platform', true)`);
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, created_at, organization_id, location_id, aggregate_type, aggregate_id, event_type,
                event_version, payload, trace_context
           FROM outbox_events
          WHERE published_at IS NULL
          ORDER BY created_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [BATCH_SIZE],
      );
      if (rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }
      const jobs = rows.flatMap((row) => {
        const envelope = this.toEnvelope(row);
        return this.registry.consumersOf(row.event_type).map((consumer) => ({
          name: row.event_type,
          data: {
            consumer,
            event: envelope,
            organizationId: row.organization_id,
            ...row.trace_context,
          },
          opts: { jobId: `${row.id}__${consumer}` },
        }));
      });
      if (jobs.length > 0) await this.events.addBulk(jobs);
      // Match by id. (Do not round-trip created_at through JS Date: it loses microseconds.)
      // The created_at bound keeps partition pruning.
      const oldest = rows.reduce(
        (min, r) => (r.created_at < min ? r.created_at : min),
        rows[0]?.created_at ?? new Date(),
      );
      await client.query(
        `UPDATE outbox_events SET published_at = now(), attempts = attempts + 1
          WHERE id = ANY($1::uuid[]) AND created_at >= $2::timestamptz - interval '1 second'`,
        [rows.map((r) => r.id), oldest],
      );
      await client.query('COMMIT');
      return rows.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  private toEnvelope(row: OutboxRow): EventEnvelope {
    return {
      id: row.id,
      type: row.event_type,
      version: row.event_version,
      occurredAt: row.created_at.toISOString(),
      organizationId: row.organization_id,
      locationId: row.location_id,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      actor: row.trace_context.actor ?? { type: 'system', id: 'system' },
      data: row.payload,
      trace: {
        ...(row.trace_context.requestId ? { requestId: row.trace_context.requestId } : {}),
        ...(row.trace_context.traceparent ? { traceparent: row.trace_context.traceparent } : {}),
      },
    };
  }

  private async resetSession(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    this.leader = false;
    await session?.end().catch(() => undefined);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }
}
