import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';

import { REDIS_KEY_PREFIX, REDIS_QUEUE } from '../redis/redis.module';
import { DEFAULT_JOB_OPTIONS, QUEUES } from './queues';

/**
 * BullMQ on the queue Redis connection (ADR-0008) with default job options; every catalogue
 * queue is registered so any module can produce to it. Processors live only in the worker.
 */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [REDIS_QUEUE, REDIS_KEY_PREFIX],
      useFactory: (connection: Redis, prefix: string) => ({
        connection,
        prefix: `${prefix}:bull`,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue(...Object.values(QUEUES).map((name) => ({ name }))),
  ],
  exports: [BullModule],
})
export class QueueModule {}
