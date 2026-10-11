import { Module } from '@nestjs/common';

/**
 * Composition root for the `worker` process (BullMQ consumers, schedulers, outbox relay).
 * Processors are registered here as modules add jobs (BACKEND.md §10).
 */
@Module({})
export class WorkerModule {}
