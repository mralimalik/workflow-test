import type { Realm } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';

import { AppConfig } from '../../../kernel/config/app-config';
import { REALM_POLICY } from '../domain/realm-policy';

/**
 * Session cookies (BACKEND.md §6.1): `HttpOnly; Secure; SameSite=Lax`, one name per realm.
 * `COOKIE_DOMAIN=localhost` means host-only (browsers ignore `Domain=localhost`).
 */
@Injectable()
export class SessionCookies {
  private readonly base: CookieOptions;

  constructor(config: AppConfig) {
    const domain = config.get('COOKIE_DOMAIN', { infer: true });
    this.base = {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      ...(domain === 'localhost' ? {} : { domain }),
    };
  }

  set(res: Response, realm: Realm, token: string, expires: Date): void {
    res.cookie(REALM_POLICY[realm].cookie, token, { ...this.base, expires });
  }

  clear(res: Response, realm: Realm): void {
    res.clearCookie(REALM_POLICY[realm].cookie, this.base);
  }
}
