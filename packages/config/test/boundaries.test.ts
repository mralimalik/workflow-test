import path from 'node:path';

import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { boundariesConfig } from '../eslint/boundaries.js';

const fixtures = path.join(import.meta.dirname, 'fixtures');

async function boundaryErrors(file: string): Promise<string[]> {
  const eslint = new ESLint({
    cwd: fixtures,
    overrideConfigFile: true,
    overrideConfig: [{ languageOptions: { parser: tseslint.parser } }, ...boundariesConfig],
  });
  const [result] = await eslint.lintFiles([path.join(fixtures, file)]);
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'boundaries/dependencies' || m.fatal)
    .map((m) => m.message);
}

describe('architectural boundaries (BACKEND.md §3.1, FRONTEND.md §3)', () => {
  it.each([
    'server/src/modules/beta/application/allowed.ts',
    'server/src/apps/api.module.ts',
    'apps/web/src/features/billing/allowed.ts',
  ])('allows %s', async (file) => {
    expect(await boundaryErrors(file)).toEqual([]);
  });

  it.each([
    'server/src/modules/beta/application/deep-import.ts',
    'server/src/modules/beta/application/deep-reexport.ts',
    'server/src/kernel/imports-module.ts',
    'apps/web/src/features/billing/deep-import.ts',
  ])('rejects %s', async (file) => {
    const errors = await boundaryErrors(file);
    expect(errors).toHaveLength(1);
  });
});
