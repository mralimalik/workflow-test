import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { EventsProcessor } from './application/events.processor';
import { OutboxRelay } from './application/outbox-relay';
import { OutboxWriter } from './application/outbox-writer';
import { EventHandlerRegistry } from './events/event-handler-registry';

/** Producer side: every process can write events. */
@Global()
@Module({ providers: [OutboxWriter], exports: [OutboxWriter] })
export class OutboxModule {}

/** Consumer side (worker only): relay + delivery of events to handlers. */
@Module({
  imports: [DiscoveryModule],
  providers: [EventHandlerRegistry, OutboxRelay, EventsProcessor],
  exports: [EventHandlerRegistry, OutboxRelay],
})
export class OutboxRelayModule {}
