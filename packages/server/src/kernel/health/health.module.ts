import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';

import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule.forRoot({ logger: false, gracefulShutdownTimeoutMs: 0 })],
  controllers: [HealthController],
})
export class HealthModule {}
