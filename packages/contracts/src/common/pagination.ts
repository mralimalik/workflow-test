import { z } from 'zod';

/** Cursor pagination query (BACKEND.md §5.5): `?limit=50&cursor=<opaque>`. */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(500).optional(),
});

export const pageMetaSchema = z
  .object({ nextCursor: z.string().nullable(), hasMore: z.boolean() })
  .meta({ id: 'PageMeta' });

/** A collection response: `{ data, meta: { nextCursor, hasMore } }` (BACKEND.md §5.4). */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), meta: pageMetaSchema });
}
