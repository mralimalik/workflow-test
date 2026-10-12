import { z } from 'zod';

import {
  localeSchema,
  phoneE164Schema,
  timestampSchema,
  timezoneSchema,
} from '../common/primitives';
import { defineRoute } from '../http/route';
import { currentUserSchema } from './auth';
import { IMAGE_CONTENT_TYPES } from './files';

const prefix = '/v1/auth/users/account';
const tags = ['Account'];
const authErrors = ['unauthenticated', 'session_expired'] as const;

/**
 * The signed-in user's own profile (features/auth-and-identity.md, API table "Own profile").
 * Lives under the `users` auth realm because `/v1/me` is the customer audience.
 */
export const accountRoutes = {
  get: defineRoute({
    id: 'account.get',
    method: 'GET',
    path: prefix,
    audience: 'auth',
    auth: 'user',
    summary: 'Get my profile',
    tags,
    responses: { 200: { description: 'My profile', schema: currentUserSchema } },
    errors: [...authErrors],
  }),
  update: defineRoute({
    id: 'account.update',
    method: 'PATCH',
    path: prefix,
    audience: 'auth',
    auth: 'user',
    summary: 'Update my profile',
    description:
      'Fields left out stay unchanged; `null` clears an optional field. To change the avatar, upload it first (`account.avatar.upload`) and pass the file id.',
    tags,
    request: {
      body: z
        .object({
          firstName: z.string().trim().min(1).max(100),
          lastName: z.string().trim().min(1).max(100).nullable(),
          phoneE164: phoneE164Schema.nullable(),
          locale: localeSchema,
          timezone: timezoneSchema.nullable(),
          avatarFileId: z.uuid().nullable(),
        })
        .partial()
        .refine((b) => Object.keys(b).length > 0, 'Provide at least one field'),
    },
    responses: { 200: { description: 'Updated profile', schema: currentUserSchema } },
    errors: [...authErrors, 'csrf_token_invalid', 'not_found'],
  }),
  avatarUpload: defineRoute({
    id: 'account.avatar.upload',
    method: 'POST',
    path: `${prefix}/avatar`,
    audience: 'auth',
    auth: 'user',
    summary: 'Get a signed URL to upload a new avatar',
    description: 'PUT the image bytes to `upload.url`, then PATCH the account with `avatarFileId`.',
    tags,
    request: {
      body: z.object({
        contentType: z.enum(IMAGE_CONTENT_TYPES),
        sizeBytes: z.int().positive(),
      }),
    },
    responses: {
      201: {
        description: 'Pending upload',
        schema: z
          .object({
            fileId: z.uuid(),
            upload: z.object({
              url: z.url(),
              method: z.literal('PUT'),
              expiresAt: timestampSchema,
            }),
          })
          .meta({ id: 'PendingUpload' }),
      },
    },
    errors: [...authErrors, 'csrf_token_invalid', 'payload_too_large', 'unsupported_media_type'],
  }),
};
