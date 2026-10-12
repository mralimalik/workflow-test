import { SetMetadata } from '@nestjs/common';
import type { EventEnvelope } from '@attendra/contracts';

export const EVENT_HANDLER = 'attendra:event-handler';

export interface EventHandlerOptions {
  /** Stable consumer name; part of the delivery job id, so never rename casually. */
  consumer: string;
  /** Event types handled, e.g. `['organization.updated']`. */
  events: readonly string[];
}

/** A consumer of domain events. Implementations must be idempotent (BACKEND.md §10.1). */
export interface DomainEventHandler {
  handle(event: EventEnvelope): Promise<void>;
}

/**
 * Marks a provider as a domain-event consumer. The outbox relay delivers each matching event
 * to it exactly once per consumer as a job on the `events` queue (job id
 * `{eventId}__{consumer}`), so retries and replays never duplicate work.
 */
export const HandlesEvents = (options: EventHandlerOptions): ClassDecorator =>
  SetMetadata(EVENT_HANDLER, options);
