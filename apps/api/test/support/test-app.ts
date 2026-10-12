import type { Server } from 'node:http';

import { type Type } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ApiModule } from '@attendra/server/apps/api.module';
import { configureHttpApp } from '@attendra/server/kernel/http/configure-app';

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
export async function createTestApp(extraControllers: Type[] = []): Promise<TestApp> {
  const logs = new LogCapture();
  const moduleRef = await Test.createTestingModule({
    imports: [ApiModule.forRoot({ logDestination: logs }), DiscoveryModule],
    controllers: extraControllers,
  }).compile();
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
