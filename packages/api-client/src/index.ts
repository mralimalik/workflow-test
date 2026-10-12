import createClient, { type ClientOptions } from 'openapi-fetch';

import type { paths } from './generated/schema';

export type { components, operations, paths } from './generated/schema';

/**
 * Typed client for the Attendra API (ADR-0014). Paths, params, bodies and responses are
 * generated from the OpenAPI document, so an API change is a type error here.
 * Cookies, CSRF header, request id and locale handling are added in milestone B1.
 */
export function createApiClient(options: ClientOptions) {
  return createClient<paths>({ credentials: 'include', ...options });
}

export type ApiClient = ReturnType<typeof createApiClient>;
