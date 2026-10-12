import type { IncomingHttpHeaders } from 'node:http';

import { Injectable } from '@nestjs/common';
import { parse } from 'cookie';

import type { Actor } from '../../../kernel/context/request-context';
import type { SocketAuthenticator } from '../../realtime/realtime.public';
import { REALM_POLICY } from '../domain/realm-policy';
import { SessionService } from './session.service';

/** Authenticates `/business` socket handshakes with the user session cookie (BACKEND.md §10.4). */
@Injectable()
export class SessionSocketAuthenticator implements SocketAuthenticator {
  constructor(private readonly sessions: SessionService) {}

  async authenticate(headers: IncomingHttpHeaders): Promise<Actor | null> {
    const token = headers.cookie ? parse(headers.cookie)[REALM_POLICY.user.cookie] : undefined;
    if (!token) return null;
    try {
      const session = await this.sessions.resolve('user', token);
      return session.mfaPending ? null : { type: 'user', id: session.subjectId };
    } catch {
      return null;
    }
  }
}
