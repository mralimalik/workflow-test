import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { MaintenanceProcessor, MaintenanceRegistry, MaintenanceSchedules } from './maintenance';
import { PartitionMaintenanceTask } from './partition-maintenance';

/** Worker only: runs recurring maintenance tasks. */
@Module({
  imports: [DiscoveryModule],
  providers: [
    MaintenanceRegistry,
    MaintenanceProcessor,
    MaintenanceSchedules,
    PartitionMaintenanceTask,
  ],
})
export class MaintenanceModule {}
