import { describe, expect, it } from 'vitest';

import { allowedOriginFor, ANY_ORIGIN } from './cors';

const origins = {
  dashboard: 'https://app.attendra.com',
  admin: 'https://admin.attendra.com',
  customerApp: 'https://my.attendra.com',
};

describe('CORS per audience (BACKEND.md §5.1)', () => {
  it.each([
    ['/v1/orgs/x/locations', origins.dashboard],
    ['/v1/auth/users/login', origins.dashboard],
    ['/v1/admin/organizations', origins.admin],
    ['/v1/auth/admins/login', origins.admin],
    ['/v1/me/bookings', origins.customerApp],
    ['/v1/auth/customers/otp', origins.customerApp],
    ['/v1/public/locations/x', ANY_ORIGIN],
    ['/v1/webhooks/stripe', null],
    ['/internal/health/live', null],
  ])('%s', (path, expected) => {
    expect(allowedOriginFor(path, origins)).toBe(expected);
  });
});
