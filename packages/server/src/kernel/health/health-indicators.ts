import type { HealthIndicatorResult } from '@nestjs/terminus';

/**
 * A readiness check contributed by a module (database, Redis…). Modules register
 * implementations under `READINESS_CHECKS` (multi-provider pattern) so the health module
 * does not depend on them.
 */
export interface ReadinessCheck {
  readonly key: string;
  check(): Promise<HealthIndicatorResult>;
}

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');
