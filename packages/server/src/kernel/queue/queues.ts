import type { JobsOptions } from 'bullmq';

/** Queue catalogue (BACKEND.md §10.3). Producers and processors use these names only. */
export const QUEUES = {
  /** Domain events delivered by the outbox relay to subscribed handlers. */
  events: 'events',
  notifications: 'notifications',
  realtime: 'realtime',
  inboundWebhooks: 'inbound-webhooks',
  maintenance: 'maintenance',
  /** Jobs that exhausted their retries, kept for inspection and replay. */
  deadLetter: 'dead-letter',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Default job options: 5 attempts, exponential backoff with jitter, bounded retention. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 2_000, jitter: 0.5 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/** Minimal job data every job carries (BACKEND.md §10.3 job conventions). */
export interface JobEnvelope {
  organizationId?: string | null;
  requestId?: string;
  /** W3C trace context of the producer. */
  traceparent?: string;
}
