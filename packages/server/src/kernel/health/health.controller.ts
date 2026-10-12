import {
  Controller,
  type OnApplicationBootstrap,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';
import { routes } from '@attendra/contracts';

import { AppError } from '../errors/app-error';
import { ContractRoute } from '../http/contract-route';
import { READINESS_CHECK, type ReadinessCheck } from './health-indicators';

/** `/internal/health/*` (BACKEND.md §8.3), used by load balancers and orchestrators. */
@Controller()
export class HealthController implements OnApplicationBootstrap {
  private checks: ReadinessCheck[] = [];

  constructor(
    private readonly health: HealthCheckService,
    private readonly discovery: DiscoveryService,
  ) {}

  onApplicationBootstrap(): void {
    this.checks = this.discovery
      .getProviders()
      .filter(
        (w) =>
          w.metatype && Reflect.getMetadata(READINESS_CHECK, w.metatype) === true && w.instance,
      )
      .map((w) => w.instance as ReadinessCheck);
  }

  @ContractRoute(routes.health.live)
  async live(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @ContractRoute(routes.health.ready)
  async ready(): Promise<HealthCheckResult> {
    try {
      return await this.health.check(this.checks.map((c) => () => c.check()));
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      const result = error.getResponse() as HealthCheckResult;
      throw new AppError('service_unavailable', {
        detail: 'One or more dependencies are unavailable',
        errors: Object.entries(result.error ?? {}).map(([path, info]) => ({
          path,
          code: 'down',
          message: typeof info?.['message'] === 'string' ? info['message'] : `${path} is down`,
        })),
        cause: error,
      });
    }
  }
}
