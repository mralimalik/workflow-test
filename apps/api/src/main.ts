import 'reflect-metadata';

import { createApiApp } from './app';

async function bootstrap(): Promise<void> {
  const app = await createApiApp();
  // Replaced by the validated AppConfig in milestone A1.
  const port = Number(process.env['API_PORT'] ?? 4000);
  await app.listen(port);
}

void bootstrap();
