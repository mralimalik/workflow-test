import { describe, expect, it } from 'vitest';

import { AUDIENCES, successStatus } from '../http/route';
import { allRoutes } from './index';

const PREFIX: Record<string, RegExp> = {
  business: /^\/v1\/orgs\/\{orgId\}/,
  customer: /^\/v1\/me(\/|$)/,
  public: /^\/v1\/public\//,
  admin: /^\/v1\/admin\//,
  auth: /^\/v1\/auth\/(users|customers|admins)\//,
  webhooks: /^\/v1\/webhooks\//,
  internal: /^\/internal\//,
};

describe('route registry invariants (ADR-0014, BACKEND.md §5)', () => {
  it('has unique ids and unique method + path pairs', () => {
    const ids = allRoutes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = allRoutes.map((r) => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(allRoutes.map((r) => [r.id, r] as const))('%s is well-formed', (_id, route) => {
    expect(AUDIENCES).toContain(route.audience);
    expect(route.path).toMatch(PREFIX[route.audience]!);
    expect(route.path).toMatch(/^(\/[a-z0-9-]+|\/\{[A-Za-z]+\})+$/);
    expect(() => successStatus(route)).not.toThrow();
    // Every path parameter is declared in the params schema, and vice versa.
    const inPath = [...route.path.matchAll(/\{([A-Za-z]+)\}/g)].map((m) => m[1]).sort();
    const declared = Object.keys(route.request?.params?.shape ?? {}).sort();
    expect(declared).toEqual(inPath);
    // Bodies only on methods that take one.
    if (route.request?.body) expect(['POST', 'PUT', 'PATCH']).toContain(route.method);
  });
});
