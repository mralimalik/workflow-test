import type { Server } from 'node:http';

import { type Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ApiModule } from '@attendra/server/apps/api.module';
import { configureHttpApp } from '@attendra/server/apps/http-app';

import { LogCapture } from './log-capture';

export interface TestApp {
  app: NestExpressApplication;
  server: Server;
  logs: LogCapture;
  close(): Promise<void>;
}

/**
 * Boots the real API module (same pipeline as production via configureHttpApp), with logs
 * captured. Extra controllers can be mounted for kernel-level tests.
 */
export interface TestAppOptions {
  /** Replace providers (by token) with test doubles, e.g. the realtime authenticator. */
  overrides?: { token: unknown; useValue: unknown }[];
}

export async function createTestApp(
  extraControllers: Type[] = [],
  options: TestAppOptions = {},
): Promise<TestApp> {
  const logs = new LogCapture();
  let builder = Test.createTestingModule({
    imports: [ApiModule.forRoot({ logDestination: logs }), DiscoveryModule],
    controllers: extraControllers,
  });
  for (const o of options.overrides ?? [])
    builder = builder.overrideProvider(o.token).useValue(o.useValue);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bufferLogs: true,
    bodyParser: false,
    rawBody: true,
  });
  configureHttpApp(app);
  await app.init();
  const server: Server = app.getHttpServer();
  return { app, server, logs, close: () => app.close() };
}
