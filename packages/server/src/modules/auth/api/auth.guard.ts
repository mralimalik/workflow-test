import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { routeAuth, type RouteDefinition } from '@attendra/contracts';
import type { Request } from 'express';

import { RequestContext } from '../../../kernel/context/request-context';
import { safeEqual } from '../../../kernel/crypto/secrets';
import { AppError, ForbiddenError, UnauthenticatedError } from '../../../kernel/errors/app-error';
import { CONTRACT_ROUTE } from '../../../kernel/http/contract-route';
import { SessionService, type ActiveSession } from '../application/session.service';
import { REALM_POLICY } from '../domain/realm-policy';

const SESSION = Symbol('attendra.session');
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const CSRF_HEADER = 'x-csrf-token';

type AuthedRequest = Request & { [SESSION]?: ActiveSession };

/**
 * Global authentication guard (BACKEND.md §4 step 6, §6). Reads the route's auth
 * requirement from its contract, resolves the realm's session cookie, enforces CSRF on
 * state-changing requests (§6.3) and records the actor in the request context. Routes
 * without a contract (none in production) are left alone.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const route = this.reflector.get<RouteDefinition | undefined>(
      CONTRACT_ROUTE,
      context.getHandler(),
    );
    if (!route) return true;
    const realm = routeAuth(route);
    if (realm === 'none') return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = (req.cookies as Record<string, string | undefined> | undefined)?.[
      REALM_POLICY[realm].cookie
    ];
    if (!token) throw new UnauthenticatedError();
    const session = await this.sessions.resolve(realm, token);

    if (!SAFE_METHODS.has(req.method)) {
      const header = req.headers[CSRF_HEADER];
      if (typeof header !== 'string' || !safeEqual(header, session.csrfToken)) {
        throw new ForbiddenError('csrf_token_invalid');
      }
    }
    if (route.audience === 'business' && session.mfaPending) {
      throw new AppError('mfa_enrollment_required');
    }

    req[SESSION] = session;
    RequestContext.assign({ actor: { type: realm, id: session.subjectId } });
    return true;
  }
}

/** The session the guard authenticated (only on routes that require one). */
export const CurrentSession = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const session = ctx.switchToHttp().getRequest<AuthedRequest>()[SESSION];
  if (!session) throw new Error('@CurrentSession() used on a route without authentication');
  return session;
});
