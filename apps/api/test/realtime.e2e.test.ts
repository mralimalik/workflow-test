import type { AddressInfo } from 'node:net';

import { newId } from '@attendra/server/kernel/ids/ids';
import {
  orgRoom,
  REALTIME_SCOPE_CHECKER,
  RealtimePublisher,
  SOCKET_AUTHENTICATOR,
  type RealtimeScopeChecker,
  type SocketAuthenticator,
} from '@attendra/server/modules/realtime/realtime.public';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from './support/test-app';

// Test doubles for what A4 (sessions) and A8 (memberships) provide.
const orgA = newId();
const orgB = newId();
const locA = newId();
const members: Record<string, string> = { alice: orgA, bob: orgB };

const authenticator: SocketAuthenticator = {
  authenticate: (headers) => {
    const name = headers['x-test-user'];
    return Promise.resolve(
      typeof name === 'string' && members[name] ? { type: 'user', id: name } : null,
    );
  },
};
const scopes: RealtimeScopeChecker = {
  canJoinOrganization: (actor, organizationId) =>
    Promise.resolve(members[actor.id] === organizationId),
  canJoinLocation: (actor, organizationId, locationId) =>
    Promise.resolve(members[actor.id] === organizationId && locationId === locA),
};

describe('real-time gateway (BACKEND.md §10.4)', () => {
  let t: TestApp;
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp([], {
      overrides: [
        { token: SOCKET_AUTHENTICATOR, useValue: authenticator },
        { token: REALTIME_SCOPE_CHECKER, useValue: scopes },
      ],
    });
    await t.app.listen(0);
    url = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}/business`;
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await t.close();
  });

  function connect(user?: string): Promise<Socket> {
    const socket = io(url, {
      transports: ['websocket'],
      extraHeaders: user ? { 'x-test-user': user } : {},
      reconnection: false,
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.on('connect', () => {
        resolve(socket);
      });
      socket.on('connect_error', reject);
    });
  }

  const subscribe = (socket: Socket, body: unknown) =>
    socket.emitWithAck('subscribe', body) as Promise<{
      ok: boolean;
      code?: string;
      rooms?: string[];
    }>;

  it('refuses unauthenticated handshakes', async () => {
    await expect(connect()).rejects.toThrow('unauthenticated');
  });

  it('a member joins their organization and location rooms', async () => {
    const alice = await connect('alice');
    expect(await subscribe(alice, { organizationId: orgA, locationId: locA })).toEqual({
      ok: true,
      rooms: [`org:${orgA}`, `loc:${locA}`],
    });
  });

  it('a socket in another organization cannot join org:{otherOrg}', async () => {
    const bob = await connect('bob');
    expect(await subscribe(bob, { organizationId: orgA })).toEqual({
      ok: false,
      code: 'forbidden',
    });
    expect(await subscribe(bob, { organizationId: 'not-a-uuid' })).toEqual({
      ok: false,
      code: 'validation_failed',
    });
  });

  it('fanout notices reach only the room they are sent to', async () => {
    const alice = await connect('alice');
    const bob = await connect('bob');
    await subscribe(alice, { organizationId: orgA });
    await subscribe(bob, { organizationId: orgB });
    const bobReceived: unknown[] = [];
    bob.on('notice', (n) => bobReceived.push(n));

    const received = new Promise((resolve) => alice.once('notice', resolve));
    await t.app
      .get(RealtimePublisher)
      .publish([orgRoom(orgA)], { type: 'location.updated', id: locA, locationId: locA }, orgA);
    expect(await received).toEqual({ type: 'location.updated', id: locA, locationId: locA });
    await new Promise((r) => setTimeout(r, 300));
    expect(bobReceived).toEqual([]);
  });
});
