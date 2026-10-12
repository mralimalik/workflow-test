import { Controller } from '@nestjs/common';
import { defineRoute, type RouteInput, type RouteResult } from '@attendra/contracts';
import {
  ContractBody,
  ContractParams,
  ContractQuery,
  ContractRoute,
} from '@attendra/server/kernel/http/contract-route';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestApp, type TestApp } from './support/test-app';

// Test-only routes exercising the kernel pipeline (not part of the registry).
const echoRoute = defineRoute({
  id: 'test.echo',
  method: 'POST',
  path: '/v1/test/widgets/{widgetId}',
  audience: 'business',
  // Pipeline tests run without a session; authentication has its own suites.
  auth: 'none',
  summary: 'Echo',
  tags: ['Test'],
  request: {
    params: z.object({ widgetId: z.uuid() }),
    query: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }),
    body: z.strictObject({ name: z.string().min(1), email: z.email(), password: z.string() }),
  },
  responses: {
    201: {
      description: 'Created',
      schema: z.object({ id: z.string(), name: z.string(), limit: z.number() }),
    },
  },
});
const failRoute = defineRoute({
  id: 'test.fail',
  method: 'GET',
  path: '/v1/test/fail',
  audience: 'business',
  auth: 'none',
  summary: 'Fail',
  tags: ['Test'],
  responses: { 200: { description: 'Never', schema: z.object({ ok: z.boolean() }) } },
});

@Controller()
class TestController {
  @ContractRoute(echoRoute)
  echo(
    @ContractParams(echoRoute) params: RouteInput<typeof echoRoute>['params'],
    @ContractQuery(echoRoute) query: RouteInput<typeof echoRoute>['query'],
    @ContractBody(echoRoute) body: RouteInput<typeof echoRoute>['body'],
  ): RouteResult<typeof echoRoute> {
    // Extra fields must be stripped by response serialization.
    return {
      id: params.widgetId,
      name: body.name,
      limit: query.limit,
      password: body.password,
    } as RouteResult<typeof echoRoute>;
  }

  @ContractRoute(failRoute)
  fail(): never {
    throw new Error('database password is hunter22');
  }
}

const widgetId = '0192f6c4-7b1e-7c3a-9d2e-5f8a1b2c3d4e';
const validBody = { name: 'Widget', email: 'owner@example.com', password: 'secret-pass' };

describe('API kernel pipeline (A1)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp([TestController]);
  });
  afterAll(async () => {
    await t.close();
  });
  beforeEach(() => {
    t.logs.clear();
  });

  it('validates and parses params, query and body; serializes the response by schema', async () => {
    const res = await request(t.server)
      .post(`/v1/test/widgets/${widgetId}?limit=10`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: widgetId, name: 'Widget', limit: 10 });
  });

  it('applies schema defaults (handler receives parsed output)', async () => {
    const res = await request(t.server).post(`/v1/test/widgets/${widgetId}`).send(validBody);
    expect(res.body.limit).toBe(50);
  });

  it('validation error → 422 problem+json with errors[].path', async () => {
    const body = await request(t.server)
      .post(`/v1/test/widgets/${widgetId}`)
      .send({ name: '', email: 'nope', password: 'x', extra: 1 });
    expect(body.status).toBe(422);
    expect(body.headers['content-type']).toContain('application/problem+json');
    expect(body.body).toMatchObject({
      code: 'validation_failed',
      status: 422,
      requestId: expect.any(String),
    });
    expect(body.body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'name', code: 'too_small' }),
        expect.objectContaining({ path: 'email', code: 'invalid_format' }),
        expect.objectContaining({ path: '', code: 'unrecognized_keys' }),
      ]),
    );

    const params = await request(t.server).post('/v1/test/widgets/not-a-uuid').send(validBody);
    expect(params.status).toBe(422);
    expect(params.body.errors).toEqual([expect.objectContaining({ path: 'params.widgetId' })]);

    const query = await request(t.server)
      .post(`/v1/test/widgets/${widgetId}?limit=0`)
      .send(validBody);
    expect(query.status).toBe(422);
    expect(query.body.errors).toEqual([
      expect.objectContaining({ path: 'query.limit', code: 'too_small' }),
    ]);
  });

  it('unknown error → 500 internal_error with requestId, nothing leaked, logged with stack', async () => {
    const res = await request(t.server).get('/v1/test/fail').set('X-Request-Id', 'e2e-fail-0001');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      type: 'https://docs.attendra.com/errors/internal_error',
      title: 'Something went wrong',
      status: 500,
      code: 'internal_error',
      detail: null,
      requestId: 'e2e-fail-0001',
    });
    const errorLine = t.logs.lines.find((l) => l['msg'] === 'Unhandled error');
    expect(errorLine).toMatchObject({ requestId: 'e2e-fail-0001', level: 50 });
    expect(JSON.stringify(errorLine)).toContain('stack');
  });

  it('every log line during a request has the requestId; secrets and PII never appear', async () => {
    await request(t.server)
      .post(`/v1/test/widgets/${widgetId}`)
      .set('X-Request-Id', 'e2e-logs-0001')
      .send(validBody);
    await request(t.server)
      .get('/v1/test/fail')
      .set('X-Request-Id', 'e2e-logs-0002')
      .set('Cookie', 'att_u=session-secret');
    const requestLines = t.logs.lines.filter((l) => 'req' in l || l['msg'] === 'Unhandled error');
    expect(requestLines.length).toBeGreaterThanOrEqual(3);
    for (const line of requestLines) expect(line['requestId']).toMatch(/^e2e-logs-000[12]$/);
    const all = JSON.stringify(t.logs.lines);
    expect(all).not.toContain('secret-pass');
    expect(all).not.toContain('session-secret');
    expect(all).not.toContain('owner@example.com');
    // Error codes are logged (as errorCode; `code` is a redacted key).
    expect(t.logs.lines.find((l) => l['msg'] === 'Unhandled error')?.['errorCode']).toBe(
      'internal_error',
    );
  });
});
