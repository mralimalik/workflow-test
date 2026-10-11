import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiModule } from '@attendra/server/apps/api.module';

/**
 * Builds the API application without listening, so tests (Supertest) and `main.ts` share
 * exactly the same setup. Global middleware, filters and OpenAPI are added in milestone A1.
 */
export async function createApiApp(): Promise<INestApplication> {
  const app = await NestFactory.create(ApiModule, { bufferLogs: true });
  app.enableShutdownHooks();
  return app;
}
