import { Injectable } from '@nestjs/common';

import { CacheService } from '../../../kernel/cache/cache.service';
import { HandlesEvents, type DomainEventHandler } from '../../outbox/outbox.public';
import { FEATURE_FLAGS_CACHE } from './feature-flags.service';

/** Event-driven invalidation of the `feature-flags` cache (BACKEND.md §9.1). */
@HandlesEvents({ consumer: 'cache.feature-flags', events: ['feature_flag.changed'] })
@Injectable()
export class FeatureFlagsCacheInvalidator implements DomainEventHandler {
  constructor(private readonly cache: CacheService) {}

  async handle(): Promise<void> {
    await this.cache.invalidate(FEATURE_FLAGS_CACHE, ['global']);
  }
}
