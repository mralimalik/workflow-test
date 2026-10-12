import { z } from 'zod';

import { defineRoute } from '../http/route';

/** Image types accepted for logos, avatars and catalogue images. */
export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export const fileUploadResultSchema = z
  .object({
    id: z.uuid(),
    status: z.enum(['ready']),
    contentType: z.string(),
    sizeBytes: z.int(),
  })
  .meta({ id: 'FileUploadResult' });

const tokenParams = z.object({ token: z.string().min(20).max(600) });

/**
 * Signed upload/download URLs for the local storage provider. With S3/Azure the client
 * talks to the bucket directly using the same signed-URL shape, and these routes are unused.
 */
export const fileRoutes = {
  upload: defineRoute({
    id: 'files.upload',
    method: 'PUT',
    path: '/v1/public/files/uploads/{token}',
    audience: 'public',
    summary: 'Upload file bytes to a signed upload URL',
    tags: ['Files'],
    request: {
      params: tokenParams,
      binaryBody: ['application/octet-stream', ...IMAGE_CONTENT_TYPES],
    },
    responses: { 200: { description: 'Stored', schema: fileUploadResultSchema } },
    errors: ['forbidden', 'not_found', 'conflict', 'payload_too_large', 'unsupported_media_type'],
  }),
  download: defineRoute({
    id: 'files.download',
    method: 'GET',
    path: '/v1/public/files/{token}',
    audience: 'public',
    summary: 'Download a file from a signed download URL',
    tags: ['Files'],
    request: { params: tokenParams },
    responses: { 200: { description: 'File bytes', binary: ['application/octet-stream'] } },
    errors: ['forbidden', 'not_found'],
  }),
};
