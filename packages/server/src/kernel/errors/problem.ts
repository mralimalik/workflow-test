import { HttpException, HttpStatus } from '@nestjs/common';
import { ERROR_CODES, PROBLEM_TYPE_BASE, type ErrorCode, type Problem } from '@attendra/contracts';

import { AppError } from './app-error';

export interface ProblemResponse {
  status: number;
  body: Problem;
  headers: Record<string, string>;
  /** Whether this is unexpected and must be logged at `error` with a stack. */
  unexpected: boolean;
}

/** Framework/HTTP-layer statuses mapped to stable codes. */
const HTTP_STATUS_CODES: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'malformed_request',
  [HttpStatus.UNAUTHORIZED]: 'unauthenticated',
  [HttpStatus.FORBIDDEN]: 'forbidden',
  [HttpStatus.NOT_FOUND]: 'route_not_found',
  [HttpStatus.METHOD_NOT_ALLOWED]: 'method_not_allowed',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'payload_too_large',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'unsupported_media_type',
  [HttpStatus.TOO_MANY_REQUESTS]: 'rate_limited',
  [HttpStatus.SERVICE_UNAVAILABLE]: 'service_unavailable',
};

/** Errors thrown by body-parser / Express carry `status` or `statusCode` and `type`. */
interface HttpLikeError {
  status?: unknown;
  statusCode?: unknown;
  type?: unknown;
  expose?: unknown;
}

function httpStatusOf(error: unknown): number | undefined {
  if (error instanceof HttpException) return error.getStatus();
  if (typeof error === 'object' && error !== null) {
    const e = error as HttpLikeError;
    const status = typeof e.status === 'number' ? e.status : e.statusCode;
    // Only trust client-error statuses from non-Nest errors that mark themselves exposable
    // (http-errors convention used by body-parser).
    if (typeof status === 'number' && status >= 400 && status < 500 && e.expose === true)
      return status;
  }
  return undefined;
}

function build(code: ErrorCode, requestId: string | undefined, detail?: string): Problem {
  return {
    type: `${PROBLEM_TYPE_BASE}${code}`,
    title: ERROR_CODES[code].title,
    status: ERROR_CODES[code].status,
    code,
    detail: detail ?? null,
    requestId: requestId ?? null,
  };
}

/**
 * Maps any thrown value to an RFC 9457 problem (BACKEND.md §11.2). Unknown errors become
 * `500 internal_error`; their message never reaches the client.
 */
export function toProblem(error: unknown, requestId: string | undefined): ProblemResponse {
  if (error instanceof AppError) {
    const body = build(error.code, requestId, error.detail);
    if (error.fieldErrors) body.errors = error.fieldErrors;
    return {
      status: error.status,
      body,
      headers: error.headers ?? {},
      unexpected: error.status >= 500,
    };
  }

  const status = httpStatusOf(error);
  if (status !== undefined) {
    const code =
      HTTP_STATUS_CODES[status] ?? (status >= 500 ? 'internal_error' : 'malformed_request');
    return {
      status: ERROR_CODES[code].status,
      body: build(code, requestId),
      headers: {},
      unexpected: status >= 500,
    };
  }

  return { status: 500, body: build('internal_error', requestId), headers: {}, unexpected: true };
}
