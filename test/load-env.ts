import fs from 'node:fs';
import path from 'node:path';

// Load the repository `.env` for integration/e2e tests when present; CI sets variables directly.
const envFile = path.resolve(import.meta.dirname, '../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
