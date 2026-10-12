import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';

import type { Actor } from '../../../kernel/context/request-context';
import {
  locRoom,
  orgRoom,
  REALTIME_SCOPE_CHECKER,
  SOCKET_AUTHENTICATOR,
  type RealtimeScopeChecker,
  type SocketAuthenticator,
} from '../application/ports';

const subscribeSchema = z.strictObject({
  organizationId: z.uuid(),
  locationId: z.uuid().optional(),
});

interface SocketData {
  actor?: Actor;
}

/**
 * `/business` namespace (BACKEND.md §10.4): authenticated on handshake; sockets join
 * `org:{id}` / `loc:{id}` only after a scope check. The server only emits small notices.
 */
@WebSocketGateway({
  namespace: '/business',
  cors: { origin: process.env['DASHBOARD_URL'] ?? false, credentials: true },
})
export class BusinessGateway implements OnGatewayInit {
  private readonly logger = new Logger(BusinessGateway.name);

  @WebSocketServer()
  server!: Namespace;

  constructor(
    @Inject(SOCKET_AUTHENTICATOR) private readonly authenticator: SocketAuthenticator,
    @Inject(REALTIME_SCOPE_CHECKER) private readonly scopes: RealtimeScopeChecker,
  ) {}

  /** Authenticates during the handshake: unauthenticated clients never connect. */
  afterInit(server: Namespace): void {
    server.use((socket, next) => {
      this.authenticator
        .authenticate(socket.handshake.headers)
        .then((actor) => {
          if (!actor) {
            next(new Error('unauthenticated'));
            return;
          }
          (socket.data as SocketData).actor = actor;
          next();
        })
        .catch(() => {
          next(new Error('unauthenticated'));
        });
    });
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<{ ok: true; rooms: string[] } | { ok: false; code: string }> {
    const actor = (socket.data as SocketData).actor;
    const parsed = subscribeSchema.safeParse(body);
    if (!actor) return { ok: false, code: 'unauthenticated' };
    if (!parsed.success) return { ok: false, code: 'validation_failed' };
    const { organizationId, locationId } = parsed.data;

    if (!(await this.scopes.canJoinOrganization(actor, organizationId))) {
      this.logger.warn({ organizationId }, 'Realtime subscription refused');
      return { ok: false, code: 'forbidden' };
    }
    const rooms = [orgRoom(organizationId)];
    if (locationId) {
      if (!(await this.scopes.canJoinLocation(actor, organizationId, locationId)))
        return { ok: false, code: 'forbidden' };
      rooms.push(locRoom(locationId));
    }
    await socket.join(rooms);
    return { ok: true, rooms };
  }
}
