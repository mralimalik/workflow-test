import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApiApp } from '../src/app';

describe('api app', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApiApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('boots and answers unknown routes with 404', async () => {
    const res = await request(app.getHttpServer() as Server).get('/v1/does-not-exist');
    expect(res.status).toBe(404);
  });
});
