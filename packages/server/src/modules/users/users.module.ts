import { Global, Module } from '@nestjs/common';

import { UsersService } from './application/users.service';

@Global()
@Module({ providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
