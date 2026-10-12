import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';

import { AppConfig } from './config/app-config';
import { envSchema } from './config/env.schema';
import { buildLoggerParams, type AppName } from './logging/logger.options';
import { Clock, SystemClock } from './time/clock';

export interface KernelOptions {
  app: AppName;
  /** Test hook: capture log lines instead of writing to stdout. */
  logDestination?: DestinationStream;
}

/**
 * Cross-cutting providers every process needs (BACKEND.md §2): validated config, logging,
 * clock. Imported once by each composition root.
 */
@Global()
@Module({})
export class KernelModule {
  static forRoot(options: KernelOptions): DynamicModule {
    return {
      module: KernelModule,
      imports: [
        // Variables come from the process environment (`node --env-file` locally, the
        // platform's secret store elsewhere); no .env parsing here.
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          cache: true,
          validationSchema: envSchema,
        }),
        LoggerModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: AppConfig) =>
            buildLoggerParams({
              app: options.app,
              level: config.get('LOG_LEVEL', { infer: true }),
              pretty:
                config.get('APP_ENV', { infer: true }) === 'local' &&
                !options.logDestination &&
                process.stdout.isTTY,
              ...(options.logDestination ? { destination: options.logDestination } : {}),
            }),
        }),
      ],
      providers: [
        // `AppConfig` is Nest's ConfigService under a typed name.
        { provide: AppConfig, useExisting: ConfigService },
        { provide: Clock, useClass: SystemClock },
      ],
      exports: [AppConfig, Clock],
    };
  }
}
