import { type ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

import { RateLimitedError } from '../errors/app-error';

/**
 * `@nestjs/throttler`'s guard with IETF `RateLimit-*` header names (BACKEND.md §5.8) and our
 * problem+json error (`429 rate_limited` + `Retry-After`).
 */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected override headerPrefix = 'RateLimit';

  protected override throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new RateLimitedError(detail.timeToBlockExpire);
  }
}
