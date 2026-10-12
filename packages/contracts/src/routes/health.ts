import { z } from 'zod';

import { defineRoute } from '../http/route';

const indicatorSchema = z.looseObject({ status: z.enum(['up', 'down', 'degraded']) });

/** Terminus health check result (BACKEND.md §8.3). */
export const healthResultSchema = z
  .object({
    status: z.enum(['ok', 'error', 'shutting_down', 'degraded']),
    info: z.record(z.string(), indicatorSchema).optional(),
    error: z.record(z.string(), indicatorSchema).optional(),
    details: z.record(z.string(), indicatorSchema),
  })
  .meta({ id: 'HealthResult' });

export const healthRoutes = {
  live: defineRoute({
    id: 'health.live',
    method: 'GET',
    path: '/internal/health/live',
    audience: 'internal',
    summary: 'Liveness: the process is up',
    tags: ['Health'],
    responses: { 200: { description: 'Process is alive', schema: healthResultSchema } },
    internal: true,
  }),
  ready: defineRoute({
    id: 'health.ready',
    method: 'GET',
    path: '/internal/health/ready',
    audience: 'internal',
    summary: 'Readiness: dependencies (Postgres, Redis) are reachable',
    tags: ['Health'],
    responses: {
      200: { description: 'Ready to serve traffic', schema: healthResultSchema },
      503: { description: 'A dependency is down', schema: healthResultSchema },
    },
    errors: ['service_unavailable'],
    internal: true,
  }),
};
