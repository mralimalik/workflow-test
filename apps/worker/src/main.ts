import './instrumentation';
import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { WorkerModule } from '@attendra/server/apps/worker.module';
import { Logger } from 'nestjs-pino';

/** Standalone Nest application context: no HTTP server; runs queue consumers (BACKEND.md §10). */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(), {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  await app.init();
}

void bootstrap();
