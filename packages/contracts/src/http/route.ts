import type { z } from 'zod';

import type { ErrorCode } from '../errors';

/** API audiences, each with its own prefix and auth (BACKEND.md §5.1). */
export const AUDIENCES = [
  'business',
  'customer',
  'public',
  'admin',
  'auth',
  'webhooks',
  'internal',
] as const;
export type Audience = (typeof AUDIENCES)[number];

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Identity realms (features/auth-and-identity.md): separate tables, cookies and sessions. */
export const REALMS = ['user', 'customer', 'platform_admin'] as const;
export type Realm = (typeof REALMS)[number];

/**
 * Who may call a route: `none` (anonymous allowed) or a realm whose session is required.
 * Defaults by audience: business → `user`, customer → `customer`, admin → `platform_admin`,
 * everything else → `none`. Routes in the `auth` audience must declare it.
 */
export type AuthRequirement = 'none' | Realm;

/** Platform admin roles (FR-ADM-007, features/super-admin.md). */
export const ADMIN_ROLES = ['super_admin', 'support', 'billing', 'read_only'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export function routeAuth(route: Pick<RouteDefinition, 'auth' | 'audience'>): AuthRequirement {
  if (route.auth) return route.auth;
  switch (route.audience) {
    case 'business':
      return 'user';
    case 'customer':
      return 'customer';
    case 'admin':
      return 'platform_admin';
    default:
      return 'none';
  }
}

/** Named rate-limit policies a route can opt into (BACKEND.md §9.3); `default` always applies. */
export const RATE_LIMIT_POLICY_NAMES = ['auth.login', 'auth.link', 'public.write'] as const;
export type RateLimitPolicyName = (typeof RATE_LIMIT_POLICY_NAMES)[number];

type ObjectSchema = z.ZodObject;

export interface RouteResponse {
  readonly description: string;
  /** Omitted for bodiless responses such as `204`, and for binary responses. */
  readonly schema?: z.ZodType;
  /** Binary response media types (file downloads); the handler streams the body. */
  readonly binary?: readonly string[];
}

/**
 * One API endpoint — the single definition shared by the server, the OpenAPI document and
 * the generated client (ADR-0014). Paths use OpenAPI syntax (`/v1/orgs/{orgId}`).
 */
export interface RouteDefinition {
  /** Stable id, `<area>.<action>`, e.g. `health.live`. Used as the OpenAPI operationId. */
  readonly id: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly audience: Audience;
  readonly summary: string;
  readonly description?: string;
  readonly tags: readonly string[];
  readonly request?: {
    readonly params?: ObjectSchema;
    readonly query?: ObjectSchema;
    readonly headers?: ObjectSchema;
    readonly body?: z.ZodType;
    /** Raw binary body (uploads): accepted media types; read as a stream, not JSON. */
    readonly binaryBody?: readonly string[];
  };
  /** Exactly one 2xx status is the success response. */
  readonly responses: Readonly<Record<number, RouteResponse>>;
  /** Error codes this endpoint may return in addition to the generic ones. */
  readonly errors?: readonly ErrorCode[];
  /** Accepts `Idempotency-Key` (BACKEND.md §5.9). */
  readonly idempotent?: boolean;
  /** Requires `If-Match` and returns `ETag` (BACKEND.md §5.7). */
  readonly versioned?: boolean;
  /** Required authentication; see {@link routeAuth} for the audience defaults. */
  readonly auth?: AuthRequirement;
  /**
   * Admin audience: roles allowed to call the route (`super_admin` is always allowed).
   * Required on every admin route.
   */
  readonly adminRoles?: readonly AdminRole[];
  /** Extra rate-limit policy for this route, on top of `default`. */
  readonly rateLimit?: RateLimitPolicyName;
  /** Excluded from published documentation (still type-checked and conformance-tested). */
  readonly internal?: boolean;
}

/** Identity helper that keeps literal types for a route definition. */
export function defineRoute<const R extends RouteDefinition>(route: R): R {
  return route;
}

/** The success (2xx) status of a route. */
export function successStatus(route: RouteDefinition): number {
  const statuses = Object.keys(route.responses)
    .map(Number)
    .filter((s) => s >= 200 && s < 300);
  const [status] = statuses;
  if (statuses.length !== 1 || status === undefined) {
    throw new Error(
      `Route ${route.id} must declare exactly one 2xx response, found ${statuses.length}`,
    );
  }
  return status;
}

type SuccessKeys<R extends RouteDefinition> = {
  [K in keyof R['responses']]: K extends 200 | 201 | 202 | 204 ? K : never;
}[keyof R['responses']];

type SchemaOutput<S> = S extends z.ZodType ? z.output<S> : undefined;

/** Parsed request parts a handler receives for route `R`. */
export interface RouteInput<R extends RouteDefinition> {
  params: SchemaOutput<NonNullable<R['request']>['params']>;
  query: SchemaOutput<NonNullable<R['request']>['query']>;
  body: SchemaOutput<NonNullable<R['request']>['body']>;
}

/** What a handler for route `R` must return (input type of the response schema). */
export type RouteResult<R extends RouteDefinition> = R['responses'][SuccessKeys<R>] extends {
  schema: infer S;
}
  ? S extends z.ZodType
    ? z.input<S>
    : undefined
  : undefined;

/** Converts an OpenAPI path template to Express syntax: `/orgs/{orgId}` → `/orgs/:orgId`. */
export function toExpressPath(path: string): string {
  return path.replace(/\{([A-Za-z0-9_]+)\}/g, ':$1');
}
