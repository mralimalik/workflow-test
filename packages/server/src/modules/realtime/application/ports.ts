import type { IncomingHttpHeaders } from 'node:http';

import type { Actor } from '../../../kernel/context/request-context';

/**
 * Authenticates a socket handshake (BACKEND.md §10.4). The user-session implementation is
 * provided by the auth module (A4); until then every handshake is refused.
 */
export interface SocketAuthenticator {
  authenticate(headers: IncomingHttpHeaders): Promise<Actor | null>;
}

/** Whether an actor may join an organization / location room. Implemented by access (A8). */
export interface RealtimeScopeChecker {
  canJoinOrganization(actor: Actor, organizationId: string): Promise<boolean>;
  canJoinLocation(actor: Actor, organizationId: string, locationId: string): Promise<boolean>;
}

export const SOCKET_AUTHENTICATOR = Symbol('SOCKET_AUTHENTICATOR');
export const REALTIME_SCOPE_CHECKER = Symbol('REALTIME_SCOPE_CHECKER');

/** Fail-closed defaults used until the real implementations are registered. */
export const denyAllAuthenticator: SocketAuthenticator = {
  authenticate: () => Promise.resolve(null),
};
export const denyAllScopes: RealtimeScopeChecker = {
  canJoinOrganization: () => Promise.resolve(false),
  canJoinLocation: () => Promise.resolve(false),
};

/** Small change notifications; clients refetch through the REST API (no data over the socket). */
export interface RealtimeNotice {
  type: string;
  id: string;
  locationId?: string | null;
}

export const orgRoom = (organizationId: string) => `org:${organizationId}`;
export const locRoom = (locationId: string) => `loc:${locationId}`;
