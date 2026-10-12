import { type INestApplication, StandardSchemaSerializerInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { allRoutes } from '@attendra/contracts';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

import { AppConfig } from '../config/app-config';
import { requestContextMiddleware } from '../context/request-context.middleware';
import { ProblemDetailsFilter } from '../errors/problem-details.filter';
import { corsDelegate } from './cors';
import { buildOpenApiDocument } from './openapi';
import { ContractValidationPipe } from './validation.pipe';

export const DOCS_PATH = 'docs';
export const BODY_LIMIT = '1mb';

/** Parses `TRUST_PROXY` (`loopback`, `2`, `true`, or a list) into Express's setting. */
function trustProxySetting(value: string): boolean | number | string {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

/**
 * HTTP pipeline for the `api` process, in BACKEND.md §4 order. Shared by `main.ts` and the
 * e2e tests so both run exactly the same stack.
 */
export function configureHttpApp(app: NestExpressApplication): void {
  const config = app.get(AppConfig);
  const isProduction = config.get('APP_ENV', { infer: true }) === 'production';

  app.useLogger(app.get(Logger));
  app.set('trust proxy', trustProxySetting(config.get('TRUST_PROXY', { infer: true })));
  app.disable('x-powered-by');

  // 1. Request context first, so everything after it (including logs) carries the request id.
  app.use(requestContextMiddleware);
  // 2. Security headers. The docs page needs to load its own scripts and styles.
  app.use(
    `/${DOCS_PATH}`,
    helmet({
      contentSecurityPolicy: {
        directives: { 'style-src': ["'self'", "'unsafe-inline'"], 'img-src': ["'self'", 'data:'] },
      },
    }),
  );
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: { 'default-src': ["'none'"], 'frame-ancestors': ["'none'"] },
      },
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  // 3. Bodies: JSON only, 1 MB (webhooks get raw-body handling in their own module).
  app.useBodyParser('json', {
    limit: BODY_LIMIT,
    type: ['application/json', 'application/*+json'],
  });
  // 4. CORS per audience.
  app.enableCors(
    corsDelegate({
      dashboard: config.get('DASHBOARD_URL', { infer: true }),
      admin: config.get('ADMIN_URL', { infer: true }),
      customerApp: config.get('CUSTOMER_APP_URL', { infer: true }),
    }),
  );

  // Validation, response serialization and error mapping (BACKEND.md §4 steps 10, 13, 14).
  app.useGlobalPipes(new ContractValidationPipe());
  app.useGlobalInterceptors(new StandardSchemaSerializerInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new ProblemDetailsFilter());

  app.enableShutdownHooks();

  if (!isProduction) mountDocs(app, config);
}

function mountDocs(app: INestApplication, config: AppConfig): void {
  const document = buildOpenApiDocument(allRoutes, {
    title: 'Attendra API',
    version: '0.0.0',
    serverUrl: config.get('API_PUBLIC_URL', { infer: true }),
    includeInternal: true,
  });
  SwaggerModule.setup(DOCS_PATH, app, document as unknown as OpenAPIObject, {
    jsonDocumentUrl: `${DOCS_PATH}/openapi.json`,
    customSiteTitle: 'Attendra API',
  });
}
