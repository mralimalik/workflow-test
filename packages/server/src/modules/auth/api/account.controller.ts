import { Controller } from '@nestjs/common';
import { routes, type RouteInput, type RouteResult } from '@attendra/contracts';

import { ContractBody, ContractRoute } from '../../../kernel/http/contract-route';
import { AccountService } from '../application/account.service';
import type { ActiveSession } from '../application/session.service';
import { CurrentSession } from './auth.guard';

const r = routes.account;

/** The signed-in user's own profile (contracts: routes.account). */
@Controller()
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @ContractRoute(r.get)
  get(@CurrentSession() session: ActiveSession): Promise<RouteResult<typeof r.get>> {
    return this.account.get(session.subjectId);
  }

  @ContractRoute(r.update)
  update(
    @CurrentSession() session: ActiveSession,
    @ContractBody(r.update) body: RouteInput<typeof r.update>['body'],
  ): Promise<RouteResult<typeof r.update>> {
    return this.account.update(session.subjectId, body);
  }

  @ContractRoute(r.avatarUpload)
  avatarUpload(
    @CurrentSession() session: ActiveSession,
    @ContractBody(r.avatarUpload) body: RouteInput<typeof r.avatarUpload>['body'],
  ): Promise<RouteResult<typeof r.avatarUpload>> {
    return this.account.createAvatarUpload(session.subjectId, body);
  }
}
