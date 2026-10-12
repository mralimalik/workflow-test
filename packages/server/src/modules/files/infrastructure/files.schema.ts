import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { bytea, id, timestamps } from '../../../kernel/db/columns';
import { currentOrganizationId } from '../../../kernel/db/rls';

export const FILE_PURPOSES = [
  'logo',
  'avatar',
  'service_image',
  'product_image',
  'recording',
  'knowledge_document',
  'export',
  'attachment',
] as const;
export const FILE_STATUSES = ['pending', 'ready', 'quarantined', 'deleted'] as const;
export type FilePurpose = (typeof FILE_PURPOSES)[number];

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '));

/**
 * `files` (data model 14): metadata for stored objects; bytes live in object storage.
 * Tenant rows are RLS-isolated; rows without an organization (user avatars, platform files)
 * are only reachable outside tenant context.
 */
export const files = pgTable(
  'files',
  {
    id: id(),
    organizationId: uuid('organization_id'),
    ownerType: text('owner_type').notNull(),
    ownerId: uuid('owner_id'),
    purpose: text('purpose').$type<FilePurpose>().notNull(),
    storageProvider: text('storage_provider').notNull(),
    bucket: text('bucket').notNull(),
    objectKey: text('object_key').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    checksumSha256: bytea('checksum_sha256'),
    originalName: text('original_name'),
    visibility: text('visibility').notNull().default('private'),
    status: text('status').$type<(typeof FILE_STATUSES)[number]>().notNull().default('pending'),
    retentionUntil: timestamp('retention_until', { withTimezone: true, mode: 'date' }),
    uploadedByType: text('uploaded_by_type').notNull(),
    uploadedById: uuid('uploaded_by_id'),
    deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('files_bucket_object_key_uq').on(t.bucket, t.objectKey),
    index('files_org_owner_idx').on(t.organizationId, t.ownerType, t.ownerId),
    check(
      'files_owner_type_ck',
      sql`${t.ownerType} in ('organization', 'customer', 'user', 'platform')`,
    ),
    check('files_purpose_ck', sql`${t.purpose} in (${list(FILE_PURPOSES)})`),
    check('files_storage_provider_ck', sql`${t.storageProvider} in ('s3', 'azure_blob', 'local')`),
    check('files_visibility_ck', sql`${t.visibility} in ('private', 'public')`),
    check('files_status_ck', sql`${t.status} in (${list(FILE_STATUSES)})`),
    check('files_size_ck', sql`${t.sizeBytes} >= 0`),
    pgPolicy('tenant_isolation', {
      for: 'all',
      using: sql`organization_id = ${currentOrganizationId}`,
      withCheck: sql`organization_id = ${currentOrganizationId}`,
    }),
    pgPolicy('global_rows', {
      for: 'all',
      using: sql`organization_id is null and ${currentOrganizationId} is null`,
      withCheck: sql`organization_id is null and ${currentOrganizationId} is null`,
    }),
  ],
).enableRLS();

export type FileRow = typeof files.$inferSelect;
