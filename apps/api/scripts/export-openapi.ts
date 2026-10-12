import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { allRoutes } from '@attendra/contracts';
import { buildOpenApiDocument } from '@attendra/server/kernel/http/openapi';

/**
 * Writes the OpenAPI document generated from the route registry to
 * packages/api-client/openapi.json, the input for the typed client (ADR-0014).
 * No app boot needed: the registry is the source.
 */
async function main(): Promise<void> {
  const document = buildOpenApiDocument(allRoutes, {
    title: 'Attendra API',
    version: '0.0.0',
    serverUrl: 'http://localhost:4000',
    includeInternal: true,
  });
  const out = path.resolve(__dirname, '../../../packages/api-client/openapi.json');
  await writeFile(out, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), out)}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
