import { Module } from '@nestjs/common';

import { IdempotencyCleanupTask } from './application/idempotency-cleanup';
import { IdempotencyInterceptor } from './application/idempotency.interceptor';
import { IdempotencyRepository } from './infrastructure/idempotency.repository';

@Module({
  providers: [IdempotencyRepository, IdempotencyInterceptor, IdempotencyCleanupTask],
  exports: [IdempotencyInterceptor],
})
export class IdempotencyModule {}
