import { ERROR_CODES, type ErrorCode, type FieldError } from '@attendra/contracts';

export interface AppErrorOptions {
  /** Human-readable explanation for this occurrence (safe to show; no secrets/PII). */
  detail?: string;
  /** Field-level errors (validation). */
  errors?: FieldError[];
  /** Extra response headers, e.g. `Retry-After`. */
  headers?: Record<string, string>;
  cause?: unknown;
}

/** Process-wide brand (survives duplicate module instances, unlike `instanceof`). */
const APP_ERROR = Symbol.for('attendra.AppError');

/** True for any AppError, even one created by another copy of this module. */
export function isAppError(value: unknown): value is AppError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[APP_ERROR] === true
  );
}

/**
 * Base of every expected error (BACKEND.md §11.1). The `code` is stable and documented in
 * `@attendra/contracts`; its HTTP status comes from the same catalogue.
 */
export class AppError extends Error {
  readonly [APP_ERROR] = true;
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string | undefined;
  readonly fieldErrors: FieldError[] | undefined;
  readonly headers: Record<string, string> | undefined;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.detail ?? ERROR_CODES[code].title, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.status = ERROR_CODES[code].status;
    this.detail = options.detail;
    this.fieldErrors = options.errors;
    this.headers = options.headers;
  }
}

type CodeWithStatus<S extends number> = {
  [K in ErrorCode]: (typeof ERROR_CODES)[K]['status'] extends S ? K : never;
}[ErrorCode];

export class ValidationError extends AppError {
  constructor(errors: FieldError[], detail?: string) {
    super('validation_failed', { errors, ...(detail ? { detail } : {}) });
  }
}

export class NotFoundError extends AppError {
  constructor(code: CodeWithStatus<404> = 'not_found', detail?: string) {
    super(code, detail ? { detail } : {});
  }
}

export class ConflictError extends AppError {
  constructor(code: CodeWithStatus<409> = 'conflict', detail?: string) {
    super(code, detail ? { detail } : {});
  }
}

export class PreconditionError extends AppError {
  constructor(code: CodeWithStatus<412 | 428> = 'version_mismatch', detail?: string) {
    super(code, detail ? { detail } : {});
  }
}

export class ForbiddenError extends AppError {
  constructor(code: CodeWithStatus<403> = 'forbidden', detail?: string) {
    super(code, detail ? { detail } : {});
  }
}

export class UnauthenticatedError extends AppError {
  constructor(code: CodeWithStatus<401> = 'unauthenticated', detail?: string) {
    super(code, detail ? { detail } : {});
  }
}

export class RateLimitedError extends AppError {
  constructor(retryAfterSeconds: number) {
    super('rate_limited', {
      headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
    });
  }
}

/** Wraps an upstream failure; never leaks the upstream body. */
export class ProviderError extends AppError {
  constructor(provider: string, cause: unknown) {
    super('provider_unavailable', { detail: `${provider} is unavailable`, cause });
  }
}
