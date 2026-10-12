import { Processor } from '@nestjs/bullmq';
import type { EventEnvelope } from '@attendra/contracts';
import type { Job } from 'bullmq';

import { AppProcessor } from '../../../kernel/queue/app-processor';
import { type JobEnvelope, QUEUES } from '../../../kernel/queue/queues';
import { EventHandlerRegistry } from '../events/event-handler-registry';

export interface EventJob extends JobEnvelope {
  consumer: string;
  event: EventEnvelope;
}

/** Delivers one domain event to one consumer (worker). */
@Processor(QUEUES.events, { concurrency: 20 })
export class EventsProcessor extends AppProcessor<EventJob> {
  constructor(private readonly registry: EventHandlerRegistry) {
    super();
  }

  protected async handle(job: Job<EventJob>): Promise<void> {
    const handler = this.registry.get(job.data.consumer);
    if (!handler) {
      // Consumer removed since the event was fanned out: nothing to do.
      this.logger.warn(
        { consumer: job.data.consumer, eventType: job.data.event.type },
        'No handler for consumer',
      );
      return;
    }
    await handler.handle(job.data.event);
  }
}
