import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';

import { AppProcessor } from '../../../kernel/queue/app-processor';
import { QUEUES } from '../../../kernel/queue/queues';
import { BusinessGateway } from '../api/business.gateway';
import type { FanoutJob } from './realtime-publisher';

/** Runs in the api process: emits a notice to rooms; the Redis adapter reaches every instance. */
@Processor(QUEUES.realtime, { concurrency: 20 })
export class RealtimeFanoutProcessor extends AppProcessor<FanoutJob> {
  constructor(private readonly gateway: BusinessGateway) {
    super();
  }

  protected handle(job: Job<FanoutJob>): Promise<void> {
    this.gateway.server.to(job.data.rooms).emit('notice', job.data.notice);
    return Promise.resolve();
  }
}
