import { SetMetadata } from '@nestjs/common';
import type { HealthIndicatorResult } from '@nestjs/terminus';

/**
 * A readiness check contributed by a module (database, Redis…). Mark the provider with
 * `@ReadinessCheckProvider()`; the health controller discovers all of them, so the health
 * module does not depend on the modules it checks.
 */
export interface ReadinessCheck {
  readonly key: string;
  check(): PromiseLike<HealthIndicatorResult>;
}

export const READINESS_CHECK = 'attendra:readiness-check';

export const ReadinessCheckProvider = (): ClassDecorator => SetMetadata(READINESS_CHECK, true);
