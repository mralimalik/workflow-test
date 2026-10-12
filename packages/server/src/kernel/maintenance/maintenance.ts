import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap, SetMetadata } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import type { Job, Queue } from 'bullmq';

import { AppProcessor } from '../queue/app-processor';
import { QUEUES } from '../queue/queues';

/**
 * A recurring platform job on the `maintenance` queue (BACKEND.md §10.3). Mark providers with
 * `@MaintenanceTaskProvider()`; one processor dispatches by job name (several BullMQ workers
 * on one queue would steal each other's jobs), and each task's cron is registered as a Job
 * Scheduler on worker start.
 */
export interface MaintenanceTask {
  readonly name: string;
  /** Cron pattern, UTC. */
  readonly schedule: string;
  run(): Promise<unknown>;
}

export const MAINTENANCE_TASK = 'attendra:maintenance-task';
export const MaintenanceTaskProvider = (): ClassDecorator => SetMetadata(MAINTENANCE_TASK, true);

@Injectable()
export class MaintenanceRegistry {
  constructor(private readonly discovery: DiscoveryService) {}

  tasks(): MaintenanceTask[] {
    return this.discovery
      .getProviders()
      .filter(
        (w) =>
          w.metatype && w.instance && Reflect.getMetadata(MAINTENANCE_TASK, w.metatype) === true,
      )
      .map((w) => w.instance as MaintenanceTask);
  }
}

@Processor(QUEUES.maintenance)
export class MaintenanceProcessor extends AppProcessor {
  constructor(private readonly registry: MaintenanceRegistry) {
    super();
  }

  protected async handle(job: Job): Promise<unknown> {
    const task = this.registry.tasks().find((t) => t.name === job.name);
    if (!task) throw new Error(`Unknown maintenance task: ${job.name}`);
    return task.run();
  }
}

@Injectable()
export class MaintenanceSchedules implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QUEUES.maintenance) private readonly queue: Queue,
    private readonly registry: MaintenanceRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    for (const task of this.registry.tasks()) {
      await this.queue.upsertJobScheduler(
        task.name,
        { pattern: task.schedule, tz: 'UTC' },
        { name: task.name },
      );
    }
  }
}
