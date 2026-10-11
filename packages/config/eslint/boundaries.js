import boundaries from 'eslint-plugin-boundaries';

/**
 * Architectural boundaries (BACKEND.md §3.1, FRONTEND.md §3).
 *
 * Backend (`packages/server/src`):
 *   - a module may import its own files freely;
 *   - another module only through its `<module>.public.ts`;
 *   - modules and composition roots may use the kernel; the kernel never imports modules;
 *   - composition roots (`src/apps`) may also import `<module>.module.ts`.
 * Frontend (`apps/<app>/src/features`):
 *   - a feature may import its own files freely, and other features only via `index.ts`.
 *
 * Patterns match the end of a path, so the same rules apply to test fixtures.
 */
const SAME_MODULE = { module: '{{ from.element.captured.module }}' };
const SAME_FEATURE = {
  app: '{{ from.element.captured.app }}',
  feature: '{{ from.element.captured.feature }}',
};

/** @type {import('eslint').Linter.Config[]} */
export const boundariesConfig = [
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { boundaries },
    settings: {
      'boundaries/include': ['**/server/src/**', '**/apps/*/src/features/**'],
      'boundaries/dependency-nodes': ['import', 'export', 'dynamic-import'],
      'boundaries/legacy-templates': false,
      'boundaries/elements': [
        { type: 'server-kernel', pattern: 'server/src/kernel' },
        { type: 'server-module', pattern: 'server/src/modules/*', capture: ['module'] },
        { type: 'server-root', pattern: 'server/src/apps' },
        { type: 'web-feature', pattern: 'apps/*/src/features/*', capture: ['app', 'feature'] },
      ],
      'import/resolver': {
        typescript: { alwaysTryTypes: true, noWarnOnMultipleProjects: true },
        node: true,
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          // Packages (`@attendra/*`, npm) are governed by package.json, not by this rule.
          checkAllOrigins: false,
          message:
            '{{ from.element.type }} may not import "{{ dependency.source }}" ({{ to.element.type }}). ' +
            'Import another module through its <module>.public.ts and another feature through its index.ts.',
          policies: [
            {
              from: { element: { type: 'server-kernel' } },
              allow: { to: { element: { type: 'server-kernel' } } },
            },
            {
              from: { element: { type: 'server-module' } },
              allow: [
                { to: { element: { type: 'server-kernel' } } },
                { to: { element: { type: 'server-module', captured: SAME_MODULE } } },
                { to: { element: { type: 'server-module', fileInternalPath: '*.public.ts' } } },
              ],
            },
            {
              from: { element: { type: 'server-root' } },
              allow: [
                { to: { element: { type: 'server-kernel' } } },
                { to: { element: { type: 'server-root' } } },
                {
                  to: {
                    element: {
                      type: 'server-module',
                      fileInternalPath: ['*.public.ts', '*.module.ts'],
                    },
                  },
                },
              ],
            },
            {
              from: { element: { type: 'web-feature' } },
              allow: [
                { to: { element: { type: 'web-feature', captured: SAME_FEATURE } } },
                {
                  to: {
                    element: {
                      type: 'web-feature',
                      captured: { app: '{{ from.element.captured.app }}' },
                      fileInternalPath: ['index.ts', 'index.tsx'],
                    },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  },
];
