import { Processor } from '@nestjs/bullmq';
import { DiscoveryService } from '@nestjs/core';
import type { Job } from 'bullmq';
import { and, eq, sql } from 'drizzle-orm';

import { Database } from '../../../kernel/db/database';
import { AppProcessor } from '../../../kernel/queue/app-processor';
import { QUEUES } from '../../../kernel/queue/queues';
import {
  inboundWebhookEvents,
  type WebhookProvider,
} from '../infrastructure/inbound-webhooks.partitioned';
import type { ProcessWebhookJob } from './inbound-webhook-store';
import { WEBHOOK_HANDLER, type InboundWebhookHandler } from './webhook-handler';

const system = { type: 'system', id: 'inbound-webhooks' } as const;

/** `inbound-webhooks/process`: dispatches a stored webhook to its provider handler. */
@Processor(QUEUES.inboundWebhooks)
export class InboundWebhooksProcessor extends AppProcessor<ProcessWebhookJob> {
  constructor(
    private readonly db: Database,
    private readonly discovery: DiscoveryService,
  ) {
    super();
  }

  private handlerFor(provider: WebhookProvider): InboundWebhookHandler | undefined {
    const wrapper = this.discovery
      .getProviders()
      .find(
        (w) =>
          w.metatype && w.instance && Reflect.getMetadata(WEBHOOK_HANDLER, w.metatype) === provider,
      );
    return wrapper?.instance as InboundWebhookHandler | undefined;
  }

  protected async handle(job: Job<ProcessWebhookJob>): Promise<string> {
    const key = and(
      eq(inboundWebhookEvents.id, job.data.webhookId),
      eq(inboundWebhookEvents.receivedAt, new Date(job.data.receivedAt)),
    );
    const scope = { actor: system, reason: 'process inbound webhook' };
    const [row] = await this.db.platformTx(scope, (tx) =>
      tx
        .update(inboundWebhookEvents)
        .set({ status: 'processing', attempts: sql`${inboundWebhookEvents.attempts} + 1` })
        .where(
          and(key, sql`${inboundWebhookEvents.status} in ('received', 'failed', 'processing')`),
        )
        .returning(),
    );
    if (!row) return 'skipped';

    const handler = this.handlerFor(row.provider);
    try {
      const outcome = handler ? await handler.handle(row) : 'ignored';
      await this.db.platformTx(scope, (tx) =>
        tx
          .update(inboundWebhookEvents)
          .set({ status: outcome, processedAt: new Date(), error: null })
          .where(key),
      );
      return outcome;
    } catch (error) {
      await this.db.platformTx(scope, (tx) =>
        tx
          .update(inboundWebhookEvents)
          .set({
            status: 'failed',
            error: error instanceof Error ? error.message.slice(0, 1000) : 'unknown',
          })
          .where(key),
      );
      throw error;
    }
  }
}
