import { Global, Module } from '@nestjs/common';

import { PlatformAdminsService } from './application/platform-admins.service';

@Global()
@Module({ providers: [PlatformAdminsService], exports: [PlatformAdminsService] })
export class PlatformAdminsModule {}
