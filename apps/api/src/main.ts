import './instrumentation';
import 'reflect-metadata';

import { AppConfig } from '@attendra/server/kernel/config/app-config';

import { createApiApp } from './app';

async function bootstrap(): Promise<void> {
  const app = await createApiApp();
  const port = app.get(AppConfig).get('API_PORT', { infer: true });
  await app.listen(port);
}

void bootstrap();
