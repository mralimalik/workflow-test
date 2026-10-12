import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from './support/test-app';

describe('API app (A1)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.close();
  });

  describe('health', () => {
    it('GET /internal/health/live → 200', async () => {
      const res = await request(t.server).get('/internal/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /internal/health/ready → 200 with the database check up', async () => {
      const res = await request(t.server).get('/internal/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.details.database.status).toBe('up');
    });
  });

  describe('request id', () => {
    it('echoes a valid X-Request-Id', async () => {
      const res = await request(t.server)
        .get('/internal/health/live')
        .set('X-Request-Id', 'client-req-1234');
      expect(res.headers['x-request-id']).toBe('client-req-1234');
    });

    it('generates a UUIDv7 when missing or unsafe', async () => {
      const res = await request(t.server)
        .get('/internal/health/live')
        .set('X-Request-Id', 'bad id\twith spaces');
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
    });
  });

  describe('errors are problem+json', () => {
    it('unknown route → 404 route_not_found', async () => {
      const res = await request(t.server).get('/v1/does-not-exist');
      expect(res.status).toBe(404);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.body).toMatchObject({
        code: 'route_not_found',
        requestId: res.headers['x-request-id'],
      });
    });

    it('malformed JSON → 400 malformed_request', async () => {
      const res = await request(t.server)
        .post('/v1/anything')
        .set('Content-Type', 'application/json')
        .send('{bad');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('malformed_request');
    });

    it('body over 1 MB → 413 payload_too_large', async () => {
      const res = await request(t.server)
        .post('/v1/anything')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ a: 'x'.repeat(1_100_000) }));
      expect(res.status).toBe(413);
      expect(res.body.code).toBe('payload_too_large');
    });
  });

  describe('security headers and CORS', () => {
    it('sets helmet headers and hides the framework', async () => {
      const res = await request(t.server).get('/internal/health/live');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['strict-transport-security']).toBeDefined();
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('allows the dashboard origin with credentials on business routes', async () => {
      const res = await request(t.server)
        .options('/v1/orgs/123/locations')
        .set('Origin', 'http://localhost:5173')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not allow other origins', async () => {
      for (const [path, origin] of [
        ['/v1/orgs/123/locations', 'https://evil.example'],
        ['/v1/admin/organizations', 'http://localhost:5173'],
      ]) {
        const res = await request(t.server)
          .options(path!)
          .set('Origin', origin!)
          .set('Access-Control-Request-Method', 'GET');
        expect(res.headers['access-control-allow-origin']).toBeUndefined();
      }
    });
  });

  describe('API docs', () => {
    it('serves the generated OpenAPI 3.1 document', async () => {
      const res = await request(t.server).get('/docs/openapi.json');
      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      expect(res.body.paths['/internal/health/live'].get.operationId).toBe('health.live');
    });

    it('serves the docs UI', async () => {
      const res = await request(t.server).get('/docs');
      expect(res.status).toBe(200);
      expect(res.text).toContain('swagger-ui');
    });
  });
});
