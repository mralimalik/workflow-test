import type { IncomingMessage, ServerResponse } from 'node:http';

import { trace } from '@opentelemetry/api';
import type { Params } from 'nestjs-pino';
import type { DestinationStream, Level } from 'pino';

import { RequestContext } from '../context/request-context';
import { sanitizeLogObject } from './sanitize';

export type AppName = 'api' | 'worker' | 'media' | 'cli';

export interface LoggerOptions {
  app: AppName;
  level: Level | 'silent';
  /** Human-readable output for local development. */
  pretty: boolean;
  /** Test hook: capture log lines. */
  destination?: DestinationStream;
}

/** Header names that may appear in request logs; everything else is dropped. */
const LOGGED_REQUEST_HEADERS = [
  'user-agent',
  'content-type',
  'content-length',
  'x-request-id',
  'origin',
];

/**
 * nestjs-pino configuration (BACKEND.md §8.1): JSON to stdout, one line per request, every
 * line enriched from RequestContext and the active OpenTelemetry span, secrets redacted and
 * PII masked.
 */
export function buildLoggerParams(options: LoggerOptions): Params {
  const pinoHttp: NonNullable<Params['pinoHttp']> = {
    level: options.level,
    base: { app: options.app },
    messageKey: 'msg',
    // Belt and braces: headers are not logged by the serializer below, but redact the
    // credential headers by path too in case a future serializer adds them.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
    mixin() {
      const ctx = RequestContext.get();
      const span = trace.getActiveSpan()?.spanContext();
      return {
        ...(ctx?.requestId ? { requestId: ctx.requestId } : {}),
        ...(span ? { traceId: span.traceId, spanId: span.spanId } : {}),
        ...(ctx?.actor ? { actor: ctx.actor } : {}),
        ...(ctx?.organizationId ? { organizationId: ctx.organizationId } : {}),
        ...(ctx?.locationId ? { locationId: ctx.locationId } : {}),
        ...(ctx?.jobId ? { jobId: ctx.jobId, queue: ctx.queue } : {}),
      };
    },
    formatters: {
      log: (obj) => sanitizeLogObject(obj),
    },
    // Health probes are frequent and uninteresting; they keep the request context.
    autoLogging: {
      ignore: (req: IncomingMessage) => (req.url ?? '').startsWith('/internal/health/'),
    },
    genReqId: (req: IncomingMessage) =>
      RequestContext.requestId ?? String(req.headers['x-request-id'] ?? ''),
    customLogLevel: (_req: IncomingMessage, res: ServerResponse, err?: Error) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req: {
        method: string;
        url: string;
        headers: Record<string, unknown>;
        raw?: { route?: { path?: string } };
      }) => ({
        method: req.method,
        // Path only: query strings may carry tokens.
        path: req.url.split('?')[0],
        headers: Object.fromEntries(
          LOGGED_REQUEST_HEADERS.filter((h) => h in req.headers).map((h) => [h, req.headers[h]]),
        ),
      }),
      res: (res: { statusCode: number | null; raw?: ServerResponse }) => ({
        statusCode: res.raw?.statusCode ?? res.statusCode,
      }),
    },
    ...(options.pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { singleLine: true, translateTime: 'SYS:HH:MM:ss.l' },
          },
        }
      : {}),
  };

  return { pinoHttp: options.destination ? [pinoHttp, options.destination] : pinoHttp };
}
