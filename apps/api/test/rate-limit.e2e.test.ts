import { Controller } from '@nestjs/common';
import { defineRoute } from '@attendra/contracts';
import { ContractRoute } from '@attendra/server/kernel/http/contract-route';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestApp, type TestApp } from './support/test-app';

const limited = defineRoute({
  id: 'test.limited',
  method: 'POST',
  path: '/v1/public/test/limited',
  audience: 'public',
  summary: 'Limited',
  tags: ['Test'],
  responses: { 200: { description: 'OK', schema: z.object({ ok: z.boolean() }) } },
  rateLimit: 'public.write',
});

@Controller()
class LimitedController {
  @ContractRoute(limited)
  hit() {
    return { ok: true };
  }
}

describe('rate limiting (BACKEND.md §9.3)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp([LimitedController]);
  });
  afterAll(async () => {
    await t.close();
  });

  it('applies the route policy with RateLimit-* headers, then 429 with Retry-After', async () => {
    const first = await request(t.server).post('/v1/public/test/limited');
    expect(first.status).toBe(200);
    expect(first.headers['ratelimit-limit-public.write']).toBe('30');
    expect(first.headers['ratelimit-remaining-public.write']).toBe('29');

    for (let i = 0; i < 29; i++)
      await request(t.server).post('/v1/public/test/limited').expect(200);
    const blocked = await request(t.server).post('/v1/public/test/limited');
    expect(blocked.status).toBe(429);
    expect(blocked.headers['content-type']).toContain('application/problem+json');
    expect(blocked.body.code).toBe('rate_limited');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('does not rate-limit internal health checks', async () => {
    for (let i = 0; i < 5; i++) {
      const res = await request(t.server).get('/internal/health/live');
      expect(res.headers['ratelimit-limit']).toBeUndefined();
    }
  });
});
