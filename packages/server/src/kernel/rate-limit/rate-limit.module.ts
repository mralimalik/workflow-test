import { Module } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { RouteDefinition } from '@attendra/contracts';
import type { Request } from 'express';

import { CONTRACT_ROUTE } from '../http/contract-route';
import { RATE_LIMIT_POLICIES } from './policies';
import { RateLimitGuard } from './rate-limit.guard';
import { RedisThrottlerStorage } from './redis-throttler.storage';

/**
 * Rate limiting with `@nestjs/throttler` on Redis (BACKEND.md §4 step 5, §9.3). Each policy
 * is a named throttler; non-default policies run only on routes whose contract names them.
 */
@Module({ providers: [RedisThrottlerStorage], exports: [RedisThrottlerStorage] })
class RateLimitStorageModule {}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RateLimitStorageModule],
      inject: [RedisThrottlerStorage, Reflector],
      useFactory: (storage: RedisThrottlerStorage, reflector: Reflector) => ({
        storage,
        setHeaders: true,
        throttlers: Object.values(RATE_LIMIT_POLICIES).map((policy) => ({
          name: policy.name,
          limit: policy.limit,
          ttl: policy.windowMs,
          ...(policy.blockMs ? { blockDuration: policy.blockMs } : {}),
          getTracker: (req: Record<string, unknown>) => policy.tracker(req as unknown as Request),
          skipIf: (context) => {
            if (context.getType() !== 'http') return true;
            const route = reflector.get<RouteDefinition | undefined>(
              CONTRACT_ROUTE,
              context.getHandler(),
            );
            if (route?.audience === 'internal') return true;
            return policy.name === 'default' ? false : route?.rateLimit !== policy.name;
          },
        })),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class RateLimitModule {}
