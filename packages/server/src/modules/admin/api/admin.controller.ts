import { Controller } from '@nestjs/common';
import { routes, type RouteInput, type RouteResult } from '@attendra/contracts';

import type { Actor } from '../../../kernel/context/request-context';
import {
  ContractBody,
  ContractParams,
  ContractQuery,
  ContractRoute,
} from '../../../kernel/http/contract-route';
import { CurrentSession, type ActiveSession } from '../../auth/auth.public';
import { AdminAdminsService } from '../application/admin-admins.service';
import { AdminPlatformService } from '../application/admin-platform.service';
import { AdminUsersService } from '../application/admin-users.service';

const r = routes.admin;
type In<K extends keyof typeof r> = RouteInput<(typeof r)[K]>;
type Out<K extends keyof typeof r> = RouteResult<(typeof r)[K]>;

const actor = (session: ActiveSession): Actor => ({
  type: 'platform_admin',
  id: session.subjectId,
});

/**
 * Admin console API (contracts: routes.admin). Roles are enforced by the auth guard from
 * each route's `adminRoles`; every mutation is audited by the services.
 */
@Controller()
export class AdminController {
  constructor(
    private readonly admins: AdminAdminsService,
    private readonly users: AdminUsersService,
    private readonly platform: AdminPlatformService,
  ) {}

  @ContractRoute(r.listAdmins)
  listAdmins(
    @ContractQuery(r.listAdmins) q: In<'listAdmins'>['query'],
  ): Promise<Out<'listAdmins'>> {
    return this.admins.list(q);
  }

  @ContractRoute(r.createAdmin)
  createAdmin(
    @CurrentSession() session: ActiveSession,
    @ContractBody(r.createAdmin) body: In<'createAdmin'>['body'],
  ): Promise<Out<'createAdmin'>> {
    return this.admins.invite(actor(session), body);
  }

  @ContractRoute(r.getAdmin)
  getAdmin(@ContractParams(r.getAdmin) p: In<'getAdmin'>['params']): Promise<Out<'getAdmin'>> {
    return this.admins.get(p.adminId);
  }

  @ContractRoute(r.updateAdmin)
  updateAdmin(
    @CurrentSession() session: ActiveSession,
    @ContractParams(r.updateAdmin) p: In<'updateAdmin'>['params'],
    @ContractBody(r.updateAdmin) body: In<'updateAdmin'>['body'],
  ): Promise<Out<'updateAdmin'>> {
    return this.admins.update(actor(session), p.adminId, body);
  }

  @ContractRoute(r.searchUsers)
  searchUsers(
    @ContractQuery(r.searchUsers) q: In<'searchUsers'>['query'],
  ): Promise<Out<'searchUsers'>> {
    return this.users.search(q);
  }

  @ContractRoute(r.getUser)
  getUser(@ContractParams(r.getUser) p: In<'getUser'>['params']): Promise<Out<'getUser'>> {
    return this.users.get(p.userId);
  }

  @ContractRoute(r.banUser)
  banUser(
    @CurrentSession() session: ActiveSession,
    @ContractParams(r.banUser) p: In<'banUser'>['params'],
    @ContractBody(r.banUser) body: In<'banUser'>['body'],
  ): Promise<Out<'banUser'>> {
    return this.users.ban(actor(session), p.userId, body.reason);
  }

  @ContractRoute(r.unbanUser)
  unbanUser(
    @CurrentSession() session: ActiveSession,
    @ContractParams(r.unbanUser) p: In<'unbanUser'>['params'],
    @ContractBody(r.unbanUser) body: In<'unbanUser'>['body'],
  ): Promise<Out<'unbanUser'>> {
    return this.users.unban(actor(session), p.userId, body.reason);
  }

  @ContractRoute(r.revokeUserSessions)
  async revokeUserSessions(
    @CurrentSession() session: ActiveSession,
    @ContractParams(r.revokeUserSessions) p: In<'revokeUserSessions'>['params'],
    @ContractBody(r.revokeUserSessions) body: In<'revokeUserSessions'>['body'],
  ): Promise<Out<'revokeUserSessions'>> {
    return { revoked: await this.users.revokeSessions(actor(session), p.userId, body.reason) };
  }

  @ContractRoute(r.listFlags)
  listFlags(@ContractQuery(r.listFlags) q: In<'listFlags'>['query']): Promise<Out<'listFlags'>> {
    return this.platform.listFlags(q);
  }

  @ContractRoute(r.createFlag)
  createFlag(
    @CurrentSession() session: ActiveSession,
    @ContractBody(r.createFlag) body: In<'createFlag'>['body'],
  ): Promise<Out<'createFlag'>> {
    return this.platform.createFlag(actor(session), body);
  }

  @ContractRoute(r.updateFlag)
  updateFlag(
    @CurrentSession() session: ActiveSession,
    @ContractParams(r.updateFlag) p: In<'updateFlag'>['params'],
    @ContractBody(r.updateFlag) body: In<'updateFlag'>['body'],
  ): Promise<Out<'updateFlag'>> {
    return this.platform.updateFlag(actor(session), p.flagId, body);
  }

  @ContractRoute(r.listFlagOverrides)
  listFlagOverrides(
    @ContractParams(r.listFlagOverrides) p: In<'listFlagOverrides'>['params'],
  ): Promise<Out<'listFlagOverrides'>> {
    return this.platform.listOverrides(p.flagId);
  }

  @ContractRoute(r.setFlagOverride)
  setFlagOverride(
    @CurrentSession() session: ActiveSession,
    @ContractParams(r.setFlagOverride) p: In<'setFlagOverride'>['params'],
    @ContractBody(r.setFlagOverride) body: In<'setFlagOverride'>['body'],
  ): Promise<Out<'setFlagOverride'>> {
    return this.platform.setOverride(actor(session), p.flagId, body);
  }

  @ContractRoute(r.deleteFlagOverride)
  async deleteFlagOverride(
    @CurrentSession() session: ActiveSession,
    @ContractParams(r.deleteFlagOverride) p: In<'deleteFlagOverride'>['params'],
  ): Promise<void> {
    await this.platform.deleteOverride(actor(session), p.flagId, p.overrideId);
  }

  @ContractRoute(r.searchAuditLogs)
  searchAuditLogs(
    @CurrentSession() session: ActiveSession,
    @ContractQuery(r.searchAuditLogs) q: In<'searchAuditLogs'>['query'],
  ): Promise<Out<'searchAuditLogs'>> {
    return this.platform.searchAudit(actor(session), q);
  }
}
