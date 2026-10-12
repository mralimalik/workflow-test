import { z } from 'zod';

const APP_ENVS = ['local', 'dev', 'staging', 'production'] as const;

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });
const redisUrl = z.url({ protocol: /^rediss?$/ });
const httpUrl = z.url({ protocol: /^https?$/ });
const wsUrl = z.url({ protocol: /^wss?$/ });

/** A base64 string that decodes to exactly 32 bytes (AES-256 keys). */
const key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, 'Must be base64 of exactly 32 bytes');

/**
 * Environment contract for every backend process (BACKEND.md §12). Validated at boot by
 * `@nestjs/config`; the process refuses to start when it fails. `.env.example` is the
 * template.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(APP_ENVS).default('local'),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),

    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    /** Express `trust proxy` setting: `loopback`, a hop count, or a comma-separated list. */
    TRUST_PROXY: z.string().default('loopback'),

    DATABASE_URL: postgresUrl,
    DATABASE_MIGRATION_URL: postgresUrl.optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(200).default(20),

    REDIS_CACHE_URL: redisUrl,
    REDIS_QUEUE_URL: redisUrl,
    /** Key namespace (`att:{namespace}`); defaults to APP_ENV. Tests isolate files with it. */
    REDIS_KEY_NAMESPACE: z
      .string()
      .regex(/^[a-z0-9_-]+$/)
      .optional(),

    API_PUBLIC_URL: httpUrl,
    MEDIA_PUBLIC_URL: wsUrl,
    DASHBOARD_URL: httpUrl,
    ADMIN_URL: httpUrl,
    CUSTOMER_APP_URL: httpUrl,
    WIDGET_CDN_URL: httpUrl,

    SESSION_SECRET: z.string().min(32),
    JWT_SIGNING_KEY: z.string().min(32),
    ENCRYPTION_MASTER_KEY: key32,
    ENCRYPTION_MASTER_KEY_ID: z.string().min(1),
    COOKIE_DOMAIN: z.string().min(1),

    /** Object storage. `local` writes to FILES_LOCAL_DIR (development, tests, single-node). */
    FILES_STORAGE: z.enum(['local']).default('local'),
    FILES_LOCAL_DIR: z.string().min(1).default('.data/files'),

    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    EMAIL_FROM: z.string().min(3),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== 'production') return;
    const localOnly = (key: keyof typeof env, reason: string): void => {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${reason} (not allowed when APP_ENV=production)`,
      });
    };
    if (env.SESSION_SECRET.startsWith('local-dev'))
      localOnly('SESSION_SECRET', 'Local placeholder secret');
    if (env.JWT_SIGNING_KEY.startsWith('local-dev'))
      localOnly('JWT_SIGNING_KEY', 'Local placeholder key');
    if (Buffer.from(env.ENCRYPTION_MASTER_KEY, 'base64').every((b) => b === 0)) {
      localOnly('ENCRYPTION_MASTER_KEY', 'All-zero master key');
    }
    for (const key of [
      'API_PUBLIC_URL',
      'DASHBOARD_URL',
      'ADMIN_URL',
      'CUSTOMER_APP_URL',
    ] as const) {
      if (!env[key].startsWith('https://')) localOnly(key, 'Must use https');
    }
  });

export type Env = z.output<typeof envSchema>;
