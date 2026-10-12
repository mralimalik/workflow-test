import { describe, expect, expectTypeOf, it } from 'vitest';

import { createApiClient } from './index';

/** Contract types compile in a client (A1 done-when): paths and payloads come from the spec. */
describe('generated API client', () => {
  it('calls a contract route with typed response data', async () => {
    const fetch: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ status: 'ok', details: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const client = createApiClient({ baseUrl: 'http://api.test', fetch });

    const { data, error } = await client.GET('/internal/health/live');
    expect(error).toBeUndefined();
    expect(data?.status).toBe('ok');
    expectTypeOf(data!.status).toEqualTypeOf<'ok' | 'error' | 'shutting_down' | 'degraded'>();

    // @ts-expect-error — unknown paths do not compile.
    void client.GET('/v1/not-a-route');
  });

  it('types problem+json errors', async () => {
    const fetch: typeof globalThis.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            type: 'x',
            title: 't',
            status: 503,
            code: 'service_unavailable',
            detail: null,
            requestId: null,
          }),
          { status: 503, headers: { 'content-type': 'application/problem+json' } },
        ),
      );
    const client = createApiClient({ baseUrl: 'http://api.test', fetch });
    const { error } = await client.GET('/internal/health/ready');
    expect(error).toMatchObject({ code: 'service_unavailable' });
  });
});
