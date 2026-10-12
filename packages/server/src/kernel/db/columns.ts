import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  integer,
  text,
  timestamp,
  uuid,
  type PgColumn,
} from 'drizzle-orm/pg-core';

import { newId } from '../ids/ids';

/**
 * Shared column helpers — the standard column groups of the data model
 * (docs/data-model/README.md §1.2). Tables are declared once per module in
 * `infrastructure/<module>.schema.ts` using these.
 */

/** `id uuid PK`, UUIDv7 generated in the app. */
export const id = () => uuid('id').primaryKey().$defaultFn(newId);

/** [base]: `created_at`, `updated_at` (UTC). `updated_at` is bumped on every update. */
export const timestamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** [base-append]: append-only tables carry only `created_at`. */
export const createdAt = () => ({
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

/**
 * [tenant]: `organization_id`. Pass the referenced column lazily
 * (`tenant(() => organizations.id)`) so modules do not import each other's schemas eagerly.
 * Tables created before `organizations` exists (none in practice) may omit it.
 */
export const tenant = (references?: () => PgColumn) => ({
  organizationId: references
    ? uuid('organization_id').notNull().references(references)
    : uuid('organization_id').notNull(),
});

/** [soft]: soft delete for user-managed configuration only. */
export const softDelete = () => ({
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
});

/** [ver]: optimistic concurrency, exposed as `ETag` (BACKEND.md §5.7). */
export const version = () => ({
  version: integer('version').notNull().default(1),
});

/** Money in integer minor units: `<name>_minor bigint` (pair with a `currency` column). */
export const money = (name: string) => bigint(`${name}_minor`, { mode: 'number' });

/** [actor]: `<verb>_by_type` + `<verb>_by_id`. */
export const actorColumns = <V extends string>(verb: V) =>
  ({
    [`${verb}ByType`]: text(`${verb}_by_type`),
    [`${verb}ById`]: uuid(`${verb}_by_id`),
  }) as Record<`${V}ByType`, ReturnType<typeof text>> & Record<`${V}ById`, ReturnType<typeof uuid>>;

/** `now()` for SQL defaults/updates where a JS clock value is not appropriate. */
export const sqlNow = sql`now()`;

/** `bytea` (hashes, ciphertext). Drizzle 0.45 has no built-in bytea column. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});
