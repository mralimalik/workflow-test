/** Connection-string helpers for the test database harness. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export function databaseOf(url: string): string {
  return new URL(url).pathname.slice(1);
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — copy .env.example to .env`);
  return value;
}

/** Template database migrated once per test run; per-file databases are cloned from it. */
export function templateName(baseDatabase: string): string {
  return `${baseDatabase}_test_template`;
}

export function testDatabasePrefix(baseDatabase: string): string {
  return `${baseDatabase}_t_`;
}
