import type { RecordedExchange, Scenario } from './scenario';

export interface ScenarioResult {
  readonly scenario: Scenario;
  readonly exchanges: readonly RecordedExchange[];
  readonly passed: boolean;
  readonly error?: string;
}

const json = (value: unknown): string => JSON.stringify(value, null, 2);

/** Renders a Markdown report of every request and (redacted) response. */
export function renderReport(
  baseUrl: string,
  startedAt: Date,
  results: readonly ScenarioResult[],
): string {
  const passed = results.filter((r) => r.passed).length;
  const lines: string[] = [
    `# API scenario report`,
    '',
    `| | |`,
    `|---|---|`,
    `| Target | ${baseUrl} |`,
    `| Started | ${startedAt.toISOString()} |`,
    `| Result | ${passed}/${results.length} scenarios passed |`,
    '',
    '| Scenario | Requirements | Steps | Result |',
    '|---|---|---|---|',
    ...results.map(
      (r) =>
        `| [${r.scenario.title}](#${r.scenario.id}) | ${r.scenario.requirements.join(', ') || '—'} | ${r.exchanges.length} | ${r.passed ? '✅ pass' : '❌ fail'} |`,
    ),
    '',
  ];

  for (const r of results) {
    lines.push(`<a id="${r.scenario.id}"></a>`, `## ${r.scenario.title}`, '');
    if (r.error) lines.push(`**Error:** \`${r.error}\``, '');
    r.exchanges.forEach((e, i) => {
      const checks = e.checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.label}`).join(' · ');
      lines.push(
        `### ${i + 1}. ${e.step}`,
        '',
        `\`${e.method} ${e.path}\` → **${e.status}** in ${e.durationMs} ms${checks ? ` — ${checks}` : ''}`,
        '',
      );
      if (e.requestBody !== undefined)
        lines.push('Request body:', '```json', json(e.requestBody), '```', '');
      lines.push('Response headers:', '```json', json(e.responseHeaders), '```', '');
      if (e.responseBody !== undefined)
        lines.push('Response body:', '```json', json(e.responseBody), '```', '');
    });
  }
  return lines.join('\n');
}
