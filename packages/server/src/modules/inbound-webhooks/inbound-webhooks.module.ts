import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { InboundWebhookStore } from './application/inbound-webhook-store';
import { InboundWebhooksProcessor } from './application/inbound-webhooks.processor';

/** Producer side (api): store + enqueue. */
@Global()
@Module({ providers: [InboundWebhookStore], exports: [InboundWebhookStore] })
export class InboundWebhooksModule {}

/** Consumer side (worker). */
@Module({ imports: [DiscoveryModule], providers: [InboundWebhooksProcessor] })
export class InboundWebhooksWorkerModule {}
