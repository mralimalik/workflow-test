import { defineScenario } from './lib/scenario';

/** Platform basics: health, request ids, problem+json errors, API docs. */
export default defineScenario({
  id: 'platform-basics',
  title: 'Platform basics: health, errors, docs',
  requirements: ['NFR-OBS', 'NFR-AVAIL'],
  async run(ctx) {
    await ctx.request('Liveness', 'GET', '/internal/health/live', { expectStatus: 200 });
    await ctx.request('Readiness', 'GET', '/internal/health/ready', { expectStatus: 200 });
    const res = await ctx.request(
      'Unknown route returns problem+json',
      'GET',
      '/v1/does-not-exist',
      {
        expectStatus: 404,
        headers: { 'X-Request-Id': 'scenario-req-0001' },
      },
    );
    ctx.check(
      'content-type is application/problem+json',
      res.headers.get('content-type')?.includes('application/problem+json') === true,
    );
    ctx.check('request id echoed', res.headers.get('x-request-id') === 'scenario-req-0001');
    const doc = await ctx.request('OpenAPI document', 'GET', '/docs/openapi.json', {
      expectStatus: 200,
    });
    ctx.check('OpenAPI 3.1', (doc.body as { openapi?: string } | undefined)?.openapi === '3.1.0');
  },
});
