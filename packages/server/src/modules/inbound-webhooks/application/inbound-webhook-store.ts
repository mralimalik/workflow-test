import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import { Database } from '../../../kernel/db/database';
import { newId } from '../../../kernel/ids/ids';
import { QUEUES } from '../../../kernel/queue/queues';
import { currentTraceContext } from '../../../kernel/queue/trace';
import { REDIS_CACHE, REDIS_KEY_PREFIX } from '../../../kernel/redis/redis.module';
import {
  inboundWebhookEvents,
  type WebhookProvider,
} from '../infrastructure/inbound-webhooks.partitioned';

const DEDUPE_TTL_S = 7 * 24 * 3600;

export interface ReceivedWebhook {
  provider: WebhookProvider;
  providerEventId: string;
  eventType: string;
  /** Raw payload with sensitive fields already stripped by the provider adapter. */
  payload: Record<string, unknown>;
  signatureValid: boolean;
}

export interface ProcessWebhookJob {
  webhookId: string;
  receivedAt: string;
  requestId?: string;
  traceparent?: string;
}

/**
 * Inbound webhooks (BACKEND.md §5.11): verified by the provider controller, stored here,
 * acknowledged immediately, processed by a worker job. Duplicates (same provider event id
 * within 7 days) are dropped; invalid signatures are kept as `rejected` for monitoring.
 */
@Injectable()
export class InboundWebhookStore {
  constructor(
    private readonly db: Database,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
    @Inject(REDIS_KEY_PREFIX) private readonly prefix: string,
    @InjectQueue(QUEUES.inboundWebhooks) private readonly queue: Queue<ProcessWebhookJob>,
  ) {}

  async receive(webhook: ReceivedWebhook): Promise<{ id: string; duplicate: boolean }> {
    const dedupeKey = `${this.prefix}:webhook-seen:${webhook.provider}:${webhook.providerEventId}`;
    if (webhook.signatureValid) {
      const first = await this.redis.set(dedupeKey, '1', 'EX', DEDUPE_TTL_S, 'NX');
      if (first !== 'OK') return { id: '', duplicate: true };
    }
    const id = newId();
    const receivedAt = new Date();
    await this.db.transaction((tx) =>
      tx.insert(inboundWebhookEvents).values({
        id,
        receivedAt,
        provider: webhook.provider,
        providerEventId: webhook.providerEventId,
        eventType: webhook.eventType,
        payload: webhook.payload,
        signatureValid: webhook.signatureValid,
        status: webhook.signatureValid ? 'received' : 'rejected',
      }),
    );
    if (webhook.signatureValid) {
      await this.queue.add(
        'process',
        { webhookId: id, receivedAt: receivedAt.toISOString(), ...currentTraceContext() },
        { jobId: `webhook__${id}` },
      );
    }
    return { id, duplicate: false };
  }
}
