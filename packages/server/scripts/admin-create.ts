import 'reflect-metadata';

import { parseArgs } from 'node:util';

import { NestFactory } from '@nestjs/core';
import { ADMIN_ROLES, emailSchema } from '@attendra/contracts';
import { z } from 'zod';

import type * as CliModule from '../src/apps/admin-cli.module';
import type * as AdminPublic from '../src/modules/admin/admin.public';

const args = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(200),
  role: z.enum(ADMIN_ROLES).default('super_admin'),
});

/**
 * `pnpm admin:create --email ops@attendra.com --name "Ops Lead" [--role super_admin]`
 *
 * The only way to create the first platform admin (plan A5). Prints a one-time link (72 h)
 * to set the password; TOTP setup is required at first sign-in. No password ever passes
 * through the shell.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
    },
  });
  const parsed = args.safeParse(values);
  if (!parsed.success) {
    console.error(`Usage: pnpm admin:create --email <email> --name <name> [--role <role>]\n`);
    console.error(z.prettifyError(parsed.error));
    process.exit(2);
  }

  // Nest DI needs decorator metadata, which tsx (esbuild) does not emit: load the tsc build.
  const { AdminCliModule } =
    (await import('../dist/apps/admin-cli.module.js')) as unknown as typeof CliModule;
  const { AdminAdminsService } =
    (await import('../dist/modules/admin/admin.public.js')) as unknown as typeof AdminPublic;
  const app = await NestFactory.createApplicationContext(AdminCliModule, { logger: ['error'] });
  try {
    const result = await app.get(AdminAdminsService).createWithLink(parsed.data);
    console.log(`Created ${result.admin.role} ${result.admin.email} (${result.admin.id}).`);
    console.log(`Set-password link (single use, expires ${result.expiresAt.toISOString()}):`);
    console.log(result.link);
  } catch (error) {
    const code = (error as { code?: string }).code;
    console.error(code === 'email_taken' ? 'An admin with this email already exists.' : error);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
