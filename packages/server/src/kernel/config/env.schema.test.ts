import { describe, expect, it } from 'vitest';

import { envSchema } from './env.schema';

const valid = {
  DATABASE_URL: 'postgres://app:pw@localhost:5432/attendra',
  REDIS_CACHE_URL: 'redis://localhost:6379/0',
  REDIS_QUEUE_URL: 'redis://localhost:6379/1',
  API_PUBLIC_URL: 'http://localhost:4000',
  MEDIA_PUBLIC_URL: 'ws://localhost:4100',
  DASHBOARD_URL: 'http://localhost:5173',
  ADMIN_URL: 'http://localhost:5174',
  CUSTOMER_APP_URL: 'http://localhost:3000',
  WIDGET_CDN_URL: 'http://localhost:5175',
  SESSION_SECRET: 'local-dev-session-secret-change-me',
  JWT_SIGNING_KEY: 'local-dev-jwt-signing-key-change-me',
  ENCRYPTION_MASTER_KEY: Buffer.alloc(32).toString('base64'),
  ENCRYPTION_MASTER_KEY_ID: 'local-1',
  COOKIE_DOMAIN: 'localhost',
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
  EMAIL_FROM: 'Attendra <no-reply@attendra.local>',
};

describe('env schema (BACKEND.md §12)', () => {
  it('parses a valid environment with defaults and coercion', () => {
    const env = envSchema.parse(valid);
    expect(env.API_PORT).toBe(4000);
    expect(env.SMTP_PORT).toBe(1025);
    expect(env.APP_ENV).toBe('local');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects missing and malformed variables', () => {
    const result = envSchema.safeParse({
      ...valid,
      DATABASE_URL: 'mysql://x',
      SESSION_SECRET: 'short',
    });
    expect(result.success).toBe(false);
    const paths = result.error?.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['DATABASE_URL', 'SESSION_SECRET']));
    expect(envSchema.safeParse({ ...valid, ENCRYPTION_MASTER_KEY: 'c2hvcnQ=' }).success).toBe(
      false,
    );
  });

  it('refuses local placeholders and plain http in production', () => {
    const result = envSchema.safeParse({ ...valid, APP_ENV: 'production', NODE_ENV: 'production' });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining([
        'SESSION_SECRET',
        'JWT_SIGNING_KEY',
        'ENCRYPTION_MASTER_KEY',
        'API_PUBLIC_URL',
        'DASHBOARD_URL',
      ]),
    );
  });
});
