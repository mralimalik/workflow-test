import { Global, Module } from '@nestjs/common';

import { AppConfig } from '../../kernel/config/app-config';
import { FilesController } from './api/files.controller';
import { FilesService } from './application/files.service';
import { LocalStorageProvider } from './infrastructure/local-storage';
import { STORAGE_PROVIDER } from './infrastructure/storage-provider';

@Global()
@Module({
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: STORAGE_PROVIDER,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        new LocalStorageProvider(config.get('FILES_LOCAL_DIR', { infer: true })),
    },
  ],
  exports: [FilesService],
})
export class FilesModule {}
