import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';

@Module({
  imports: [
    TerminusModule.forRoot({ logger: false, gracefulShutdownTimeoutMs: 0 }),
    DiscoveryModule,
  ],
  controllers: [HealthController],
})
export class HealthModule {}
