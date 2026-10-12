import { Module } from '@nestjs/common';

import { AuthCoreModule } from '../auth/auth.public';
import { AdminController } from './api/admin.controller';
import { AdminAdminsService } from './application/admin-admins.service';
import { AdminPlatformService } from './application/admin-platform.service';
import { AdminUsersService } from './application/admin-users.service';

/**
 * Admin console API (features/super-admin.md). Owns no tables: it orchestrates the modules
 * that do (platform-admins, users, auth, feature-flags, audit) through their public APIs.
 */
@Module({
  imports: [AuthCoreModule],
  controllers: [AdminController],
  providers: [AdminAdminsService, AdminUsersService, AdminPlatformService],
})
export class AdminModule {}
