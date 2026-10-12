import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ApiModule } from '@attendra/server/apps/api.module';
import { configureHttpApp } from '@attendra/server/kernel/http/configure-app';
import type { KernelOptions } from '@attendra/server/kernel/kernel.module';

/**
 * Builds the API application without listening, so tests (Supertest) and `main.ts` share
 * exactly the same setup.
 */
export async function createApiApp(
  options: Omit<KernelOptions, 'app'> = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(ApiModule.forRoot(options), {
    bufferLogs: true,
    bodyParser: false,
    rawBody: true,
  });
  configureHttpApp(app);
  return app;
}
