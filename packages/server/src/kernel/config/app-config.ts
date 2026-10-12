import { ConfigService } from '@nestjs/config';

import type { Env } from './env.schema';

/**
 * Typed, validated configuration (BACKEND.md §12). This is Nest's own `ConfigService`
 * with the env schema as its type: `config.get('API_PORT', { infer: true })` is a number.
 */
export class AppConfig extends ConfigService<Env, true> {}
