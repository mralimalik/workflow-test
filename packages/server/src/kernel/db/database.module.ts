import { Global, Injectable, Module, type DynamicModule } from '@nestjs/common';
import { HealthIndicatorService } from '@nestjs/terminus';

import { AppConfig } from '../config/app-config';
import { ReadinessCheckProvider, type ReadinessCheck } from '../health/health-indicators';
import { Database } from './database';

@ReadinessCheckProvider()
@Injectable()
export class DatabaseReadinessCheck implements ReadinessCheck {
  readonly key = 'database';

  constructor(
    private readonly database: Database,
    private readonly indicators: HealthIndicatorService,
  ) {}

  check() {
    return this.indicators
      .check(this.key)
      .attempt(() => this.database.ping())
      .withTimeout(2000);
  }
}

export interface DatabaseModuleOptions {
  /** 5 s for the API, 60 s for workers (BACKEND.md §7.5). */
  statementTimeoutMs: number;
  applicationName: string;
}

/** Provides {@link Database} (runtime role) to the whole process. */
@Global()
@Module({})
export class DatabaseModule {
  static forRoot(options: DatabaseModuleOptions): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: Database,
          inject: [AppConfig],
          useFactory: (config: AppConfig) =>
            new Database({
              connectionString: config.get('DATABASE_URL', { infer: true }),
              poolMax: config.get('DATABASE_POOL_MAX', { infer: true }),
              statementTimeoutMs: options.statementTimeoutMs,
              applicationName: options.applicationName,
            }),
        },
        HealthIndicatorService,
        DatabaseReadinessCheck,
      ],
      exports: [Database],
    };
  }
}
