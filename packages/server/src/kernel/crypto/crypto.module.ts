import { Global, Module } from '@nestjs/common';

import { AppConfig } from '../config/app-config';
import { EnvelopeCipher } from './envelope';

/** Envelope encryption with the configured master key (BACKEND.md §12). */
@Global()
@Module({
  providers: [
    {
      provide: EnvelopeCipher,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new EnvelopeCipher({
          id: config.get('ENCRYPTION_MASTER_KEY_ID', { infer: true }),
          key: Buffer.from(config.get('ENCRYPTION_MASTER_KEY', { infer: true }), 'base64'),
        }),
    },
  ],
  exports: [EnvelopeCipher],
})
export class CryptoModule {}
