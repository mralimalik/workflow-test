import { InjectQueue, OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { context } from '@opentelemetry/api';
import type { Job, Queue } from 'bullmq';

import { RequestContext } from '../context/request-context';
import { newId } from '../ids/ids';
import { type JobEnvelope, QUEUES } from './queues';
import { contextFrom } from './trace';

/**
 * Base class for every BullMQ processor (BACKEND.md §10.3): runs the job inside a
 * RequestContext (request id, job id, queue) continuing the producer's trace, logs its
 * outcome, and moves jobs that exhausted their attempts to the dead-letter queue. Processors
 * implement `handle` and must be idempotent; they open their own tenant transactions.
 */
export abstract class AppProcessor<
  D extends JobEnvelope = JobEnvelope,
  R = unknown,
> extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);

  /** Property injection, so subclasses keep their own constructors. */
  @InjectQueue(QUEUES.deadLetter)
  private readonly deadLetter!: Queue;

  protected abstract handle(job: Job<D>): Promise<R>;

  override async process(job: Job<D>): Promise<R> {
    const store = {
      requestId: job.data.requestId ?? newId(),
      jobId: job.id ?? 'unknown',
      queue: job.queueName,
      ...(job.data.organizationId ? { organizationId: job.data.organizationId } : {}),
    };
    return context.with(contextFrom(job.data.traceparent), () =>
      RequestContext.run(store, async () => {
        const started = Date.now();
        const result = await this.handle(job);
        this.logger.log(
          { jobName: job.name, attempt: job.attemptsMade + 1, durationMs: Date.now() - started },
          'Job completed',
        );
        return result;
      }),
    );
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<D> | undefined, error: Error): Promise<void> {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    const fields = {
      jobId: job.id,
      queue: job.queueName,
      jobName: job.name,
      attempt: job.attemptsMade,
      err: error,
    };
    if (!final) {
      this.logger.warn(fields, 'Job failed; will retry');
      return;
    }
    this.logger.error(fields, 'Job failed permanently; moved to dead-letter');
    await this.deadLetter.add(
      `${job.queueName}:${job.name}`,
      {
        queue: job.queueName,
        name: job.name,
        jobId: job.id,
        data: job.data,
        error: error.message,
        failedAt: new Date().toISOString(),
      },
      { removeOnComplete: false, removeOnFail: false },
    );
  }
}
