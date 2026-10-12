import { z } from 'zod';

import { ValidationError } from '../errors/app-error';

/**
 * Opaque keyset cursors (BACKEND.md §5.5): the sort key + id of the last row, as base64url
 * JSON. Decoding validates the shape, so a tampered cursor is a `422`, never a query error.
 */
export function encodeCursor(value: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function decodeCursor<S extends z.ZodType>(
  cursor: string | undefined,
  schema: S,
): z.output<S> | undefined {
  if (cursor === undefined) return undefined;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new ValidationError([
      { path: 'cursor', code: 'invalid_cursor', message: 'The cursor is invalid' },
    ]);
  }
}

/** The common keyset: newest first by `created_at`, ties broken by `id`. */
export const createdAtCursor = z
  .object({ t: z.iso.datetime(), id: z.uuid() })
  .transform((c) => ({ createdAt: new Date(c.t), id: c.id }));

export const encodeCreatedAtCursor = (row: { createdAt: Date; id: string }) =>
  encodeCursor({ t: row.createdAt.toISOString(), id: row.id });

/**
 * Builds a page from `limit + 1` fetched rows: the extra row only signals `hasMore`.
 */
export function toPage<R, T>(
  rows: readonly R[],
  limit: number,
  map: (row: R) => T,
  cursorOf: (row: R) => string,
): { data: T[]; meta: { nextCursor: string | null; hasMore: boolean } } {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    data: pageRows.map(map),
    meta: { nextCursor: hasMore && last !== undefined ? cursorOf(last) : null, hasMore },
  };
}
