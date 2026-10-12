import { z } from 'zod';

import type { ErrorCode } from '../errors';
import { pageOf, pageQuerySchema } from '../common/pagination';
import { emailSchema, timestampSchema } from '../common/primitives';
import { ADMIN_ROLES, defineRoute } from '../http/route';
import { sessionListItemSchema } from './auth';

/** Admin console API (features/super-admin.md). Every route declares its allowed roles. */

const adminErrors = [
  'unauthenticated',
  'session_expired',
  'forbidden',
  'mfa_enrollment_required',
] as const satisfies ErrorCode[];
const adminWriteErrors = [...adminErrors, 'csrf_token_invalid'] as const satisfies ErrorCode[];

export const adminAccountSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: z.enum(ADMIN_ROLES),
    status: z.enum(['active', 'disabled']),
    mfaEnabled: z.boolean(),
    lastLoginAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
  })
  .meta({ id: 'AdminAccount' });

export const adminUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    emailVerified: z.boolean(),
    firstName: z.string(),
    lastName: z.string().nullable(),
    status: z.enum(['active', 'disabled', 'banned']),
    bannedAt: timestampSchema.nullable(),
    banReason: z.string().nullable(),
    mfaEnabled: z.boolean(),
    lastLoginAt: timestampSchema.nullable(),
    createdAt: timestampSchema,
  })
  .meta({ id: 'AdminUser' });

export const FLAG_TYPES = ['boolean', 'string', 'number', 'json'] as const;
export const FLAG_SCOPES = ['plan', 'organization', 'location', 'user'] as const;

export const featureFlagSchema = z
  .object({
    id: z.uuid(),
    key: z.string(),
    description: z.string(),
    type: z.enum(FLAG_TYPES),
    defaultValue: z.json(),
    rolloutPercent: z.int().min(0).max(100),
    isArchived: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .meta({ id: 'FeatureFlag' });

export const featureFlagOverrideSchema = z
  .object({
    id: z.uuid(),
    scopeType: z.enum(FLAG_SCOPES),
    scopeId: z.uuid(),
    value: z.json(),
    expiresAt: timestampSchema.nullable(),
    setByPlatformAdminId: z.uuid().nullable(),
    createdAt: timestampSchema,
  })
  .meta({ id: 'FeatureFlagOverride' });

export const auditLogEntrySchema = z
  .object({
    id: z.uuid(),
    occurredAt: timestampSchema,
    organizationId: z.uuid().nullable(),
    locationId: z.uuid().nullable(),
    actorType: z.string(),
    actorId: z.uuid().nullable(),
    action: z.string(),
    targetType: z.string().nullable(),
    targetId: z.uuid().nullable(),
    changes: z.record(z.string(), z.json()),
    context: z.record(z.string(), z.json()),
    requestId: z.string().nullable(),
    ip: z.string().nullable(),
  })
  .meta({ id: 'AuditLogEntry' });

const flagKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/, 'Dotted lower-case key, e.g. ordering.enabled');
const reasonBody = z.object({ reason: z.string().trim().min(3).max(500) });
const tags = {
  admins: ['Admin · admins'],
  users: ['Admin · users'],
  flags: ['Admin · feature flags'],
  audit: ['Admin · audit'],
};
const ALL = ['support', 'billing', 'read_only'] as const;
const SUPPORT = ['support'] as const;
const SUPER = [] as const;

export const adminRoutes = {
  listAdmins: defineRoute({
    id: 'admin.admins.list',
    method: 'GET',
    path: '/v1/admin/admins',
    audience: 'admin',
    adminRoles: SUPER,
    summary: 'List platform admins',
    tags: tags.admins,
    request: { query: pageQuerySchema },
    responses: { 200: { description: 'Admins', schema: pageOf(adminAccountSchema) } },
    errors: [...adminErrors],
  }),
  createAdmin: defineRoute({
    id: 'admin.admins.create',
    method: 'POST',
    path: '/v1/admin/admins',
    audience: 'admin',
    adminRoles: SUPER,
    idempotent: true,
    summary: 'Invite a platform admin',
    description:
      'Creates the admin and emails a link to set a password (valid 72 hours). TOTP setup is required at first sign-in.',
    tags: tags.admins,
    request: {
      body: z.object({
        email: emailSchema,
        name: z.string().trim().min(1).max(200),
        role: z.enum(ADMIN_ROLES),
      }),
    },
    responses: { 201: { description: 'Invited', schema: adminAccountSchema } },
    errors: [...adminWriteErrors, 'email_taken'],
  }),
  getAdmin: defineRoute({
    id: 'admin.admins.get',
    method: 'GET',
    path: '/v1/admin/admins/{adminId}',
    audience: 'admin',
    adminRoles: SUPER,
    summary: 'Get a platform admin',
    tags: tags.admins,
    request: { params: z.object({ adminId: z.uuid() }) },
    responses: { 200: { description: 'Admin', schema: adminAccountSchema } },
    errors: [...adminErrors, 'not_found'],
  }),
  updateAdmin: defineRoute({
    id: 'admin.admins.update',
    method: 'PATCH',
    path: '/v1/admin/admins/{adminId}',
    audience: 'admin',
    adminRoles: SUPER,
    summary: 'Change an admin’s name, role or status',
    description:
      'Disabling signs the admin out everywhere. The last active super admin cannot be demoted or disabled.',
    tags: tags.admins,
    request: {
      params: z.object({ adminId: z.uuid() }),
      body: z
        .object({
          name: z.string().trim().min(1).max(200),
          role: z.enum(ADMIN_ROLES),
          status: z.enum(['active', 'disabled']),
        })
        .partial()
        .refine((b) => Object.keys(b).length > 0, 'Provide at least one field'),
    },
    responses: { 200: { description: 'Updated', schema: adminAccountSchema } },
    errors: [...adminWriteErrors, 'not_found', 'last_super_admin'],
  }),

  searchUsers: defineRoute({
    id: 'admin.users.search',
    method: 'GET',
    path: '/v1/admin/users',
    audience: 'admin',
    adminRoles: SUPPORT,
    summary: 'Search business users',
    description: '`q` matches the email or name (case-insensitive). Newest first.',
    tags: tags.users,
    request: {
      query: pageQuerySchema.extend({
        q: z.string().trim().min(1).max(200).optional(),
        status: z.enum(['active', 'disabled', 'banned']).optional(),
      }),
    },
    responses: { 200: { description: 'Users', schema: pageOf(adminUserSchema) } },
    errors: [...adminErrors],
  }),
  getUser: defineRoute({
    id: 'admin.users.get',
    method: 'GET',
    path: '/v1/admin/users/{userId}',
    audience: 'admin',
    adminRoles: SUPPORT,
    summary: 'Get a user with their active sessions',
    tags: tags.users,
    request: { params: z.object({ userId: z.uuid() }) },
    responses: {
      200: {
        description: 'User',
        schema: adminUserSchema.extend({
          sessions: z.array(sessionListItemSchema.omit({ current: true })),
        }),
      },
    },
    errors: [...adminErrors, 'not_found'],
  }),
  banUser: defineRoute({
    id: 'admin.users.ban',
    method: 'POST',
    path: '/v1/admin/users/{userId}/ban',
    audience: 'admin',
    adminRoles: SUPPORT,
    summary: 'Ban a user (signs them out everywhere)',
    tags: tags.users,
    request: { params: z.object({ userId: z.uuid() }), body: reasonBody },
    responses: { 200: { description: 'Banned', schema: adminUserSchema } },
    errors: [...adminWriteErrors, 'not_found', 'conflict'],
  }),
  unbanUser: defineRoute({
    id: 'admin.users.unban',
    method: 'POST',
    path: '/v1/admin/users/{userId}/unban',
    audience: 'admin',
    adminRoles: SUPPORT,
    summary: 'Lift a ban',
    tags: tags.users,
    request: { params: z.object({ userId: z.uuid() }), body: reasonBody },
    responses: { 200: { description: 'Active again', schema: adminUserSchema } },
    errors: [...adminWriteErrors, 'not_found', 'conflict'],
  }),
  revokeUserSessions: defineRoute({
    id: 'admin.users.revoke_sessions',
    method: 'POST',
    path: '/v1/admin/users/{userId}/revoke-sessions',
    audience: 'admin',
    adminRoles: SUPPORT,
    summary: 'Sign a user out everywhere',
    tags: tags.users,
    request: { params: z.object({ userId: z.uuid() }), body: reasonBody },
    responses: {
      200: { description: 'Revoked', schema: z.object({ revoked: z.int().nonnegative() }) },
    },
    errors: [...adminWriteErrors, 'not_found'],
  }),

  listFlags: defineRoute({
    id: 'admin.feature_flags.list',
    method: 'GET',
    path: '/v1/admin/feature-flags',
    audience: 'admin',
    adminRoles: ALL,
    summary: 'List feature flags',
    tags: tags.flags,
    request: {
      query: pageQuerySchema.extend({ includeArchived: z.stringbool().default(false) }),
    },
    responses: { 200: { description: 'Flags by key', schema: pageOf(featureFlagSchema) } },
    errors: [...adminErrors],
  }),
  createFlag: defineRoute({
    id: 'admin.feature_flags.create',
    method: 'POST',
    path: '/v1/admin/feature-flags',
    audience: 'admin',
    adminRoles: SUPER,
    idempotent: true,
    summary: 'Create a feature flag',
    tags: tags.flags,
    request: {
      body: z.object({
        key: flagKey,
        description: z.string().trim().min(1).max(500),
        type: z.enum(FLAG_TYPES),
        defaultValue: z.json(),
        rolloutPercent: z.int().min(0).max(100).default(0),
      }),
    },
    responses: { 201: { description: 'Created', schema: featureFlagSchema } },
    errors: [...adminWriteErrors, 'conflict'],
  }),
  updateFlag: defineRoute({
    id: 'admin.feature_flags.update',
    method: 'PATCH',
    path: '/v1/admin/feature-flags/{flagId}',
    audience: 'admin',
    adminRoles: SUPER,
    summary: 'Change a feature flag',
    tags: tags.flags,
    request: {
      params: z.object({ flagId: z.uuid() }),
      body: z
        .object({
          description: z.string().trim().min(1).max(500),
          defaultValue: z.json(),
          rolloutPercent: z.int().min(0).max(100),
          isArchived: z.boolean(),
        })
        .partial()
        .refine((b) => Object.keys(b).length > 0, 'Provide at least one field'),
    },
    responses: { 200: { description: 'Updated', schema: featureFlagSchema } },
    errors: [...adminWriteErrors, 'not_found'],
  }),
  listFlagOverrides: defineRoute({
    id: 'admin.feature_flags.overrides.list',
    method: 'GET',
    path: '/v1/admin/feature-flags/{flagId}/overrides',
    audience: 'admin',
    adminRoles: ALL,
    summary: 'List a flag’s overrides',
    tags: tags.flags,
    request: { params: z.object({ flagId: z.uuid() }) },
    responses: {
      200: {
        description: 'Overrides',
        schema: z.object({ data: z.array(featureFlagOverrideSchema) }),
      },
    },
    errors: [...adminErrors, 'not_found'],
  }),
  setFlagOverride: defineRoute({
    id: 'admin.feature_flags.overrides.set',
    method: 'POST',
    path: '/v1/admin/feature-flags/{flagId}/overrides',
    audience: 'admin',
    adminRoles: SUPER,
    summary: 'Set an override for a plan, organization, location or user',
    description: 'Replaces any existing override for the same scope.',
    tags: tags.flags,
    request: {
      params: z.object({ flagId: z.uuid() }),
      body: z.object({
        scopeType: z.enum(FLAG_SCOPES),
        scopeId: z.uuid(),
        value: z.json(),
        expiresAt: z.iso.datetime().nullable().default(null),
      }),
    },
    responses: { 200: { description: 'Stored', schema: featureFlagOverrideSchema } },
    errors: [...adminWriteErrors, 'not_found'],
  }),
  deleteFlagOverride: defineRoute({
    id: 'admin.feature_flags.overrides.delete',
    method: 'DELETE',
    path: '/v1/admin/feature-flags/{flagId}/overrides/{overrideId}',
    audience: 'admin',
    adminRoles: SUPER,
    summary: 'Remove an override',
    tags: tags.flags,
    request: { params: z.object({ flagId: z.uuid(), overrideId: z.uuid() }) },
    responses: { 204: { description: 'Removed' } },
    errors: [...adminWriteErrors, 'not_found'],
  }),

  searchAuditLogs: defineRoute({
    id: 'admin.audit_logs.search',
    method: 'GET',
    path: '/v1/admin/audit-logs',
    audience: 'admin',
    adminRoles: ALL,
    summary: 'Search the audit trail',
    description: 'Newest first. Time range defaults to the last 30 days.',
    tags: tags.audit,
    request: {
      query: pageQuerySchema.extend({
        organizationId: z.uuid().optional(),
        actorType: z.string().max(40).optional(),
        actorId: z.uuid().optional(),
        action: z.string().max(100).optional(),
        targetType: z.string().max(60).optional(),
        targetId: z.uuid().optional(),
        from: z.iso.datetime().optional(),
        to: z.iso.datetime().optional(),
      }),
    },
    responses: { 200: { description: 'Entries', schema: pageOf(auditLogEntrySchema) } },
    errors: [...adminErrors],
  }),
};
