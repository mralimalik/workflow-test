import { setTimeout as sleep } from 'node:timers/promises';

import { Controller } from '@nestjs/common';
import { defineRoute, type RouteInput } from '@attendra/contracts';
import { ContractBody, ContractRoute } from '@attendra/server/kernel/http/contract-route';
import { AppError } from '@attendra/server/kernel/errors/app-error';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createTestApp, type TestApp } from './support/test-app';

const createThing = defineRoute({
  id: 'test.things.create',
  method: 'POST',
  path: '/v1/public/test/things',
  audience: 'public',
  summary: 'Create',
  tags: ['Test'],
  request: {
    body: z.object({ name: z.string(), delayMs: z.int().optional(), fail: z.boolean().optional() }),
  },
  responses: {
    201: { description: 'Created', schema: z.object({ id: z.number(), name: z.string() }) },
  },
  idempotent: true,
});
const notIdempotent = defineRoute({
  id: 'test.things.plain',
  method: 'POST',
  path: '/v1/public/test/plain',
  audience: 'public',
  summary: 'Plain',
  tags: ['Test'],
  request: { body: z.object({ name: z.string() }) },
  responses: {
    201: { description: 'Created', schema: z.object({ id: z.number(), name: z.string() }) },
  },
});

let calls = 0;

@Controller()
class ThingsController {
  @ContractRoute(createThing)
  async create(@ContractBody(createThing) body: RouteInput<typeof createThing>['body']) {
    calls++;
    if (body.delayMs) await sleep(body.delayMs);
    if (body.fail) throw new AppError('conflict', { detail: 'Simulated failure' });
    return { id: calls, name: body.name, internalNote: 'stripped by the response schema' };
  }

  @ContractRoute(notIdempotent)
  plain(@ContractBody(notIdempotent) body: RouteInput<typeof notIdempotent>['body']) {
    calls++;
    return { id: calls, name: body.name };
  }
}

const key = (n: number) => `e2e-idem-key-${String(n).padStart(6, '0')}`;

describe('Idempotency-Key (BACKEND.md §5.9)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp([ThingsController]);
  });
  afterAll(async () => {
    await t.close();
  });

  it('same key + same body → identical stored response; handler runs once', async () => {
    const before = calls;
    const first = await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(1))
      .send({ name: 'A' });
    const replay = await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(1))
      .send({ name: 'A' });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual(first.body);
    expect(first.body).toEqual({ id: expect.any(Number), name: 'A' });
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(calls - before).toBe(1);
  });

  it('key order in the body does not matter (canonical hash)', async () => {
    await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(2))
      .send({ name: 'B', delayMs: 1 })
      .expect(201);
    const replay = await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(2))
      .send({ delayMs: 1, name: 'B' });
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });

  it('same key + different body → 422 idempotency_key_reused', async () => {
    await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(3))
      .send({ name: 'C' })
      .expect(201);
    const res = await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(3))
      .send({ name: 'D' });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('idempotency_key_reused');
  });

  it('a replay while the first request is running → 409 request_in_progress', async () => {
    const slow = request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(4))
      .send({ name: 'E', delayMs: 500 });
    const firstPromise = slow.then((r) => r);
    await sleep(100);
    const concurrent = await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(4))
      .send({ name: 'E', delayMs: 500 });
    expect(concurrent.status).toBe(409);
    expect(concurrent.body.code).toBe('request_in_progress');
    expect((await firstPromise).status).toBe(201);
  });

  it('a failed request frees the key for a retry', async () => {
    const failed = await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(5))
      .send({ name: 'F', fail: true });
    expect(failed.status).toBe(409);
    const retry = await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(5))
      .send({ name: 'F', fail: true });
    expect(retry.status).toBe(409);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });

  it('keys are scoped to the subject: the same key from another IP is independent', async () => {
    await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(6))
      .send({ name: 'G' })
      .expect(201);
    // trust proxy = loopback, so X-Forwarded-For from loopback sets req.ip.
    const other = await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', key(6))
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ name: 'H' });
    expect(other.status).toBe(201);
    expect(other.headers['idempotent-replayed']).toBeUndefined();
  });

  it('rejects malformed keys and ignores the header on routes that are not idempotent', async () => {
    const bad = await request(t.server)
      .post('/v1/public/test/things')
      .set('Idempotency-Key', 'short')
      .send({ name: 'I' });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].path).toBe('headers.idempotency-key');

    const a = await request(t.server)
      .post('/v1/public/test/plain')
      .set('Idempotency-Key', key(7))
      .send({ name: 'J' });
    const b = await request(t.server)
      .post('/v1/public/test/plain')
      .set('Idempotency-Key', key(7))
      .send({ name: 'J' });
    expect(a.body.id).not.toBe(b.body.id);
  });
});
