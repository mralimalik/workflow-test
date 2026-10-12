import type {
  CorsOptions,
  CorsOptionsDelegate,
} from '@nestjs/common/interfaces/external/cors-options.interface.js';
import type { Request } from 'express';

export interface AudienceOrigins {
  dashboard: string;
  admin: string;
  customerApp: string;
}

const ALLOWED_HEADERS = [
  'Content-Type',
  'Accept',
  'Accept-Language',
  'X-Request-Id',
  'X-CSRF-Token',
  'Idempotency-Key',
  'If-Match',
];
const EXPOSED_HEADERS = [
  'X-Request-Id',
  'ETag',
  'Location',
  'Retry-After',
  'RateLimit-Limit',
  'RateLimit-Remaining',
  'RateLimit-Reset',
];

/** Marks audiences that accept any origin (without credentials). */
export const ANY_ORIGIN = Symbol('any-origin');

/** Which first-party origin may call a path, by audience prefix (BACKEND.md §5.1). */
export function allowedOriginFor(
  path: string,
  origins: AudienceOrigins,
): string | typeof ANY_ORIGIN | null {
  if (path.startsWith('/v1/admin') || path.startsWith('/v1/auth/admins')) return origins.admin;
  if (
    path.startsWith('/v1/orgs') ||
    path.startsWith('/v1/auth/users') ||
    path.startsWith('/v1/invitations')
  ) {
    return origins.dashboard;
  }
  if (path.startsWith('/v1/me') || path.startsWith('/v1/auth/customers'))
    return origins.customerApp;
  // Widget and public pages: any origin, never with credentials. Widget keys check origins.
  if (path.startsWith('/v1/public')) return ANY_ORIGIN;
  // Webhooks and internal endpoints are server-to-server: no CORS.
  return null;
}

/** Per-audience CORS allowlist (BACKEND.md §4 step 4), using Nest's built-in CORS support. */
export function corsDelegate(origins: AudienceOrigins): CorsOptionsDelegate<Request> {
  return (req, callback) => {
    const allowed = allowedOriginFor(req.path, origins);
    const requestOrigin = req.headers.origin;
    const base: CorsOptions = {
      allowedHeaders: ALLOWED_HEADERS,
      exposedHeaders: EXPOSED_HEADERS,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      maxAge: 600,
    };
    if (allowed === ANY_ORIGIN) {
      callback(null, { ...base, origin: true, credentials: false });
    } else if (allowed && requestOrigin === allowed) {
      callback(null, { ...base, origin: allowed, credentials: true });
    } else {
      callback(null, { origin: false });
    }
  };
}
