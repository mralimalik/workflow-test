import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_ENV: z.enum(['local', 'dev', 'staging', 'production']).default('local'),
  DATABASE_MIGRATION_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type ScriptEnv = z.infer<typeof schema>;

/** Validates the environment for database scripts; exits with a readable message on error. */
export function loadScriptEnv(): ScriptEnv {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error(`Invalid environment for database scripts:\n${z.prettifyError(parsed.error)}`);
    console.error('Copy .env.example to .env at the repository root (README → Local development).');
    process.exit(1);
  }
  return parsed.data;
}

/** Log-safe form of a connection string (password removed). */
export function redactUrl(url: string): string {
  const u = new URL(url);
  if (u.password) u.password = '***';
  return u.toString();
}
