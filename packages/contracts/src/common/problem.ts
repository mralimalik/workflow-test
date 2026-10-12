import { z } from 'zod';

/** One field-level validation error inside a problem document. */
export const fieldErrorSchema = z
  .object({
    path: z
      .string()
      .meta({ description: 'Dot path to the field, e.g. `address.city`', example: 'email' }),
    code: z.string().meta({ example: 'invalid_format' }),
    message: z.string(),
  })
  .meta({ id: 'FieldError' });

/** RFC 9457 problem details, as returned by every error response (BACKEND.md §11.2). */
export const problemSchema = z
  .object({
    type: z.url(),
    title: z.string(),
    status: z.int(),
    code: z.string().meta({ description: 'Stable machine-readable error code' }),
    detail: z.string().nullable(),
    requestId: z.string().nullable(),
    errors: z.array(fieldErrorSchema).optional(),
  })
  .meta({ id: 'Problem', description: 'RFC 9457 problem details' });

export type Problem = z.infer<typeof problemSchema>;
export type FieldError = z.infer<typeof fieldErrorSchema>;

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
