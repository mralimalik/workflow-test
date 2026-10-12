import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';

import { type JobEnvelope, QUEUES } from '../../../kernel/queue/queues';
import { currentTraceContext } from '../../../kernel/queue/trace';
import type { RealtimeNotice } from './ports';

export interface FanoutJob extends JobEnvelope {
  rooms: string[];
  notice: RealtimeNotice;
}

/** Queues a notice for the api processes to emit (`realtime/fanout`). Usable from any process. */
@Injectable()
export class RealtimePublisher {
  constructor(@InjectQueue(QUEUES.realtime) private readonly queue: Queue<FanoutJob>) {}

  async publish(
    rooms: string[],
    notice: RealtimeNotice,
    organizationId: string | null,
  ): Promise<void> {
    await this.queue.add(
      'fanout',
      { rooms, notice, organizationId, ...currentTraceContext() },
      { attempts: 3 },
    );
  }
}
