import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Test projects (docs/plans/phase-0-foundation.md §1):
 *   unit         *.test.ts             pure logic, no I/O
 *   integration  *.int.test.ts         real Postgres + Redis; one database per test file,
 *                                      cloned from a template migrated once per run
 *   e2e          *.e2e.test.ts         the real Nest app over HTTP (Supertest)
 * SWC compiles TypeScript so Nest's decorator metadata is emitted.
 */
const swcPlugin = swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2023' } });
const exclude = ['**/node_modules/**', '**/dist/**', '**/test/fixtures/**'];

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [swcPlugin],
        test: {
          name: 'unit',
          include: ['{apps,packages}/*/{src,test,scenarios}/**/*.test.ts'],
          exclude: [...exclude, '**/*.int.test.ts', '**/*.e2e.test.ts'],
        },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'integration',
          include: ['{apps,packages}/*/{src,test}/**/*.int.test.ts'],
          exclude,
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/load-env.ts', './test/db-per-file.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'e2e',
          include: ['{apps,packages}/*/{src,test}/**/*.e2e.test.ts'],
          exclude,
          globalSetup: ['./test/global-setup.ts'],
          setupFiles: ['./test/load-env.ts', './test/db-per-file.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['{apps,packages}/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/main.ts', '**/index.ts'],
      reporter: ['text-summary', 'lcov'],
    },
  },
});
