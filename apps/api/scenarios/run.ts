import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { renderReport, type ScenarioResult } from './lib/report';
import { ScenarioContext, type Scenario } from './lib/scenario';

/**
 * `pnpm api:scenarios [--only <id>] [--base-url <url>]`
 * Runs every `*.scenario.ts` against a running API and writes
 * reports/api-scenarios/<timestamp>.md (docs/plans/phase-0-foundation.md §1).
 */
async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { only: { type: 'string', multiple: true }, 'base-url': { type: 'string' } },
  });
  const baseUrl = values['base-url'] ?? process.env['API_PUBLIC_URL'] ?? 'http://localhost:4000';

  const files = (await fs.readdir(__dirname)).filter((f) => f.endsWith('.scenario.ts')).sort();
  const scenarios: Scenario[] = [];
  for (const file of files) {
    const mod = (await import(path.join(__dirname, file))) as { default: Scenario };
    if (!values.only || values.only.includes(mod.default.id)) scenarios.push(mod.default);
  }
  if (scenarios.length === 0) throw new Error('No scenarios matched.');

  const startedAt = new Date();
  const results: ScenarioResult[] = [];
  for (const scenario of scenarios) {
    const ctx = new ScenarioContext(baseUrl);
    try {
      await scenario.run(ctx);
      results.push({ scenario, exchanges: ctx.exchanges, passed: !ctx.failed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ scenario, exchanges: ctx.exchanges, passed: false, error: message });
    }
    const passed = results.at(-1)?.passed === true;
    console.log(`${passed ? '✔' : '✘'} ${scenario.id} (${ctx.exchanges.length} requests)`);
  }

  const outDir = path.resolve(__dirname, '../../../reports/api-scenarios');
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, `${startedAt.toISOString().replace(/[:.]/g, '-')}.md`);
  await fs.writeFile(outFile, renderReport(baseUrl, startedAt, results));
  console.log(`Report: ${path.relative(path.resolve(__dirname, '../../..'), outFile)}`);

  if (results.some((r) => !r.passed)) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
