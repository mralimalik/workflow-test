import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

import { EVENT_HANDLER, type DomainEventHandler, type EventHandlerOptions } from './event-handler';

export interface RegisteredHandler {
  options: EventHandlerOptions;
  instance: DomainEventHandler;
}

/** Discovers `@HandlesEvents()` providers in the process. */
@Injectable()
export class EventHandlerRegistry implements OnApplicationBootstrap {
  private handlers: RegisteredHandler[] = [];

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    const seen = new Set<string>();
    this.handlers = this.discovery
      .getProviders()
      .filter((w) => w.metatype && w.instance && Reflect.getMetadata(EVENT_HANDLER, w.metatype))
      .map((w) => ({
        options: Reflect.getMetadata(EVENT_HANDLER, w.metatype as object) as EventHandlerOptions,
        instance: w.instance as DomainEventHandler,
      }));
    for (const h of this.handlers) {
      if (seen.has(h.options.consumer))
        throw new Error(`Duplicate event consumer name: ${h.options.consumer}`);
      seen.add(h.options.consumer);
    }
  }

  consumersOf(eventType: string): string[] {
    return this.handlers
      .filter((h) => h.options.events.includes(eventType))
      .map((h) => h.options.consumer);
  }

  get(consumer: string): DomainEventHandler | undefined {
    return this.handlers.find((h) => h.options.consumer === consumer)?.instance;
  }
}
