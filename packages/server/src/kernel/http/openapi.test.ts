import { allRoutes, defineRoute } from '@attendra/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { buildOpenApiDocument } from './openapi';

const options = {
  title: 'T',
  version: '1',
  serverUrl: 'http://localhost:4000',
  includeInternal: true,
};

describe('OpenAPI generation (ADR-0014)', () => {
  it('produces an OpenAPI 3.1 document with every registry route', () => {
    const doc = buildOpenApiDocument(allRoutes, options);
    expect(doc.openapi).toBe('3.1.0');
    for (const route of allRoutes) {
      const op = (
        doc.paths?.[route.path] as Record<string, { operationId?: string }> | undefined
      )?.[route.method.toLowerCase()];
      expect(op?.operationId).toBe(route.id);
    }
    expect(doc.components?.schemas).toHaveProperty('Problem');
  });

  it('omits internal routes from published documents', () => {
    const doc = buildOpenApiDocument(allRoutes, { ...options, includeInternal: false });
    expect(Object.keys(doc.paths ?? {})).not.toContain('/internal/health/live');
  });

  it('documents params, body, success and problem responses', () => {
    const route = defineRoute({
      id: 'demo.update',
      method: 'PATCH',
      path: '/v1/demo/{demoId}',
      audience: 'business',
      summary: 'Update',
      tags: ['Demo'],
      request: { params: z.object({ demoId: z.uuid() }), body: z.object({ name: z.string() }) },
      responses: {
        200: { description: 'Updated', schema: z.object({ id: z.uuid(), name: z.string() }) },
      },
      errors: ['not_found', 'version_mismatch'],
      versioned: true,
    });
    const doc = buildOpenApiDocument([route], options);
    const op = (doc.paths?.['/v1/demo/{demoId}'] as Record<string, Record<string, unknown>>)[
      'patch'
    ]!;
    expect(op['parameters']).toEqual([
      expect.objectContaining({ in: 'path', name: 'demoId', required: true }),
    ]);
    expect(op['requestBody']).toBeDefined();
    expect(Object.keys(op['responses'] as object).sort()).toEqual([
      '200',
      '400',
      '404',
      '412',
      '413',
      '422',
      '428',
      '500',
    ]);
  });

  it('rejects duplicate method + path', () => {
    const route = allRoutes[0]!;
    expect(() => buildOpenApiDocument([route, { ...route, id: 'dup' }], options)).toThrow(
      /Duplicate route/,
    );
  });
});
