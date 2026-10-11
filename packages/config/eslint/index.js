import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { boundariesConfig } from './boundaries.js';

export { boundariesConfig };

/**
 * Shared flat config (BACKEND.md §15): typescript-eslint strict + type-checked rules,
 * architectural boundaries, Prettier owns formatting.
 *
 * @param {{ tsconfigRootDir: string, ignores?: string[] }} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function createConfig({ tsconfigRootDir, ignores = [] }) {
  return tseslint.config(
    {
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/coverage/**',
        '**/.turbo/**',
        '**/test/fixtures/**',
        'reports/**',
        '.claude/**',
        ...ignores,
      ],
    },
    js.configs.recommended,
    {
      files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
      extends: [...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
        globals: { ...globals.node },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
        // Nest modules are classes with decorators and no members.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
        eqeqeq: ['error', 'always'],
        'no-console': 'off',
      },
    },
    {
      files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
      languageOptions: { globals: { ...globals.node } },
    },
    {
      files: ['**/*.test.ts', '**/test/**/*.ts'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/unbound-method': 'off',
      },
    },
    ...boundariesConfig,
    prettier,
  );
}
