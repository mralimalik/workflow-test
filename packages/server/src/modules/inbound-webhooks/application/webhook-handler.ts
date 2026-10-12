import { SetMetadata } from '@nestjs/common';

import type { WebhookProvider } from '../infrastructure/inbound-webhooks.partitioned';

export interface StoredWebhook {
  id: string;
  provider: WebhookProvider;
  providerEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
}

/** Processes verified webhooks of one provider (registered by provider modules, Phase 2). */
export interface InboundWebhookHandler {
  /** Returns `ignored` for event types the platform does not act on. */
  handle(webhook: StoredWebhook): Promise<'processed' | 'ignored'>;
}

export const WEBHOOK_HANDLER = 'attendra:webhook-handler';
export const HandlesWebhooks = (provider: WebhookProvider): ClassDecorator =>
  SetMetadata(WEBHOOK_HANDLER, provider);
