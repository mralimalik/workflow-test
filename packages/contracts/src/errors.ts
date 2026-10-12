/**
 * Stable error codes (BACKEND.md §11). Clients switch on `code`, never on `title`/`detail`.
 * Adding a code is additive; renaming or removing one is a breaking change.
 */
export const ERROR_CODES = {
  // Generic
  internal_error: { status: 500, title: 'Something went wrong' },
  malformed_request: { status: 400, title: 'The request could not be parsed' },
  validation_failed: { status: 422, title: 'The request is invalid' },
  route_not_found: { status: 404, title: 'No such endpoint' },
  method_not_allowed: { status: 405, title: 'Method not allowed' },
  payload_too_large: { status: 413, title: 'The request body is too large' },
  unsupported_media_type: { status: 415, title: 'Unsupported content type' },
  not_found: { status: 404, title: 'The resource was not found' },
  conflict: { status: 409, title: 'The request conflicts with the current state' },
  version_mismatch: { status: 412, title: 'The resource has changed; reload and retry' },
  precondition_required: { status: 428, title: 'An If-Match header is required' },
  rate_limited: { status: 429, title: 'Too many requests' },
  idempotency_key_reused: {
    status: 422,
    title: 'This Idempotency-Key was already used with a different request',
  },
  request_in_progress: {
    status: 409,
    title: 'A request with this Idempotency-Key is still in progress',
  },
  service_unavailable: { status: 503, title: 'The service is temporarily unavailable' },
  // Auth and access
  unauthenticated: { status: 401, title: 'Authentication is required' },
  forbidden: { status: 403, title: 'You are not allowed to do this' },
  csrf_token_invalid: { status: 403, title: 'Missing or invalid CSRF token' },
  // Providers
  provider_unavailable: { status: 502, title: 'An upstream provider is unavailable' },
} as const satisfies Record<string, { status: number; title: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_CODES, value);
}

/** Base URL for the `type` member of problem documents. */
export const PROBLEM_TYPE_BASE = 'https://docs.attendra.com/errors/';
