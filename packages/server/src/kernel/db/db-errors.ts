import { DrizzleQueryError } from 'drizzle-orm/errors';
import type { ErrorCode } from '@attendra/contracts';

import { AppError, ConflictError, NotFoundError, ValidationError } from '../errors/app-error';

/** The subset of node-postgres `DatabaseError` we read. */
export interface PgErrorLike {
  code: string;
  constraint?: string;
  table?: string;
  column?: string;
  detail?: string;
}

/** SQLSTATE codes we map (https://www.postgresql.org/docs/17/errcodes-appendix.html). */
export const PG = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  notNullViolation: '23502',
  exclusionViolation: '23P01',
  insufficientPrivilege: '42501',
  serializationFailure: '40001',
  deadlockDetected: '40P01',
  queryCanceled: '57014',
} as const;

/** Finds the Postgres error behind a Drizzle error (or a raw pg error). */
export function pgErrorOf(error: unknown): PgErrorLike | undefined {
  const candidate = error instanceof DrizzleQueryError ? error.cause : error;
  if (typeof candidate === 'object' && candidate !== null && 'code' in candidate) {
    const code = candidate.code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return candidate as PgErrorLike;
  }
  return undefined;
}

/** Errors worth retrying the whole transaction for. */
export function isRetryableDbError(error: unknown): boolean {
  const code = pgErrorOf(error)?.code;
  return code === PG.serializationFailure || code === PG.deadlockDetected;
}

/**
 * Translates expected database errors to AppErrors (BACKEND.md §11). `constraints` maps
 * constraint names to the specific code a module wants (e.g.
 * `{ organizations_slug_uq: 'organization_slug_taken' }`). Unknown errors are returned
 * unchanged so they surface as `500 internal_error`.
 */
export function mapDbError(
  error: unknown,
  constraints: Partial<Record<string, ErrorCode>> = {},
): unknown {
  const pg = pgErrorOf(error);
  if (!pg) return error;
  const specific = pg.constraint ? constraints[pg.constraint] : undefined;
  if (specific) return new AppError(specific, { cause: error });

  switch (pg.code) {
    case PG.uniqueViolation:
    case PG.exclusionViolation:
      return new ConflictError('conflict', undefined);
    case PG.foreignKeyViolation:
      // A reference to a row that does not exist (or is in another tenant: RLS hides it).
      return new NotFoundError('not_found', 'A referenced resource does not exist');
    case PG.checkViolation:
    case PG.notNullViolation:
      return new ValidationError([
        { path: pg.column ?? '', code: 'constraint', message: pg.constraint ?? 'Invalid value' },
      ]);
    case PG.insufficientPrivilege:
      // RLS WITH CHECK failure: writing a row for another organization. Never reveal it.
      return new NotFoundError();
    default:
      return error;
  }
}
