import type { AddressInfo } from 'node:net';

import { Controller } from '@nestjs/common';
import { defineRoute } from '@attendra/contracts';
import { Database } from '@attendra/server/kernel/db/database';
import { ContractRoute } from '@attendra/server/kernel/http/contract-route';
import { Clock, FixedClock } from '@attendra/server/kernel/time/clock';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import { io } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { as, signup, STRONG_PASSWORD } from './support/auth';
import { createTestApp, type TestApp } from './support/test-app';

const HOUR = 3_600_000;
const SESSION = '/v1/auth/users/session';

/** Session lifetimes (features/auth-and-identity.md rule 7) with a controllable clock. */
describe('user session lifetimes', () => {
  let t: TestApp;
  const clock = new FixedClock(new Date());

  beforeAll(async () => {
    t = await createTestApp([], { overrides: [{ token: Clock, useValue: clock }] });
  });
  afterAll(async () => {
    await t.close();
  });

  it('idle timeout is 12 h and slides with activity', async () => {
    const user = await signup(t.server);
    clock.advance(11 * HOUR);
    expect((await as(t.server, user).get(SESSION)).status).toBe(200);
    // Activity at +11 h moved the idle expiry to +23 h.
    clock.advance(11 * HOUR);
    expect((await as(t.server, user).get(SESSION)).status).toBe(200);
    clock.advance(12 * HOUR + 1000);
    const expired = await as(t.server, user).get(SESSION);
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe('session_expired');
    clock.advance(-12 * HOUR);
    // Expired sessions are revoked, not just refused.
    expect((await as(t.server, user).get(SESSION)).status).toBe(401);
  });

  it('absolute lifetime is 30 days even with constant activity', async () => {
    const user = await signup(t.server);
    // Active every 11 h (inside the 12 h idle window) for just under 30 days.
    for (let elapsed = 11 * HOUR; elapsed < 30 * 24 * HOUR; elapsed += 11 * HOUR) {
      clock.advance(11 * HOUR);
      expect((await as(t.server, user).get(SESSION)).status).toBe(200);
    }
    clock.advance(11 * HOUR);
    expect((await as(t.server, user).get(SESSION)).status).toBe(401);
  });
});

/** The real session authenticator on the `/business` socket namespace (BACKEND.md §10.4). */
describe('socket handshake with a user session', () => {
  let t: TestApp;
  let url: string;

  beforeAll(async () => {
    t = await createTestApp();
    await t.app.listen(0);
    url = `http://127.0.0.1:${(t.app.getHttpServer().address() as AddressInfo).port}/business`;
  });
  afterAll(async () => {
    await t.close();
  });

  const connect = (cookie?: string) =>
    new Promise<'connected' | 'refused'>((resolve) => {
      const socket = io(url, {
        transports: ['websocket'],
        extraHeaders: cookie ? { cookie } : {},
        reconnection: false,
      });
      socket.on('connect', () => {
        socket.disconnect();
        resolve('connected');
      });
      socket.on('connect_error', () => {
        resolve('refused');
      });
    });

  it('accepts a valid session cookie and refuses missing or revoked ones', async () => {
    const user = await signup(t.server);
    expect(await connect(user.cookie)).toBe('connected');
    expect(await connect()).toBe('refused');
    expect(await connect('att_u=forged-token-forged-token-forged-token-1234')).toBe('refused');
    await as(t.server, user).post('/v1/auth/users/logout');
    expect(await connect(user.cookie)).toBe('refused');
  });
});

// A business-audience route (default auth: user session) for guard behaviour.
const pingRoute = defineRoute({
  id: 'test.business.ping',
  method: 'POST',
  path: '/v1/orgs/test/ping',
  audience: 'business',
  summary: 'Ping',
  tags: ['Test'],
  responses: { 200: { description: 'Pong', schema: z.object({ ok: z.boolean() }) } },
});

@Controller()
class PingController {
  @ContractRoute(pingRoute)
  ping() {
    return { ok: true };
  }
}

/** Business endpoints require a user session, CSRF, and 2FA when an organization demands it. */
describe('business audience guard', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp([PingController]);
  });
  afterAll(async () => {
    await t.close();
  });

  it('requires a session and a CSRF token', async () => {
    const user = await signup(t.server);
    expect((await request(t.server).post('/v1/orgs/test/ping')).status).toBe(401);
    expect(
      (await request(t.server).post('/v1/orgs/test/ping').set('Cookie', user.cookie)).body.code,
    ).toBe('csrf_token_invalid');
    expect((await as(t.server, user).post('/v1/orgs/test/ping')).body).toEqual({ ok: true });
  });

  it('refuses a user who must enrol in 2FA until they do (mfa_required)', async () => {
    const user = await signup(t.server);
    await t.app
      .get(Database)
      .transaction((tx) =>
        tx.execute(sql`update users set mfa_required = true where id = ${user.userId}`),
      );
    const fresh = clientFromLogin(
      await request(t.server)
        .post('/v1/auth/users/login')
        .send({ email: user.email, password: STRONG_PASSWORD }),
      user,
    );
    expect(fresh.body['mfaEnrollmentRequired']).toBe(true);
    const blocked = await as(t.server, fresh).post('/v1/orgs/test/ping');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('mfa_enrollment_required');

    const enroll = await as(t.server, fresh)
      .post('/v1/auth/users/mfa/totp/enroll')
      .send({ password: STRONG_PASSWORD });
    await as(t.server, fresh)
      .post('/v1/auth/users/mfa/totp/confirm')
      .send({ code: generateSync({ secret: enroll.body.secret as string }) });
    expect((await as(t.server, fresh).post('/v1/orgs/test/ping')).status).toBe(200);
    // Required 2FA cannot be turned off.
    const disable = await as(t.server, fresh)
      .post('/v1/auth/users/mfa/totp/disable')
      .send({ password: STRONG_PASSWORD });
    expect(disable.status).toBe(403);
  });
});

function clientFromLogin(res: request.Response, base: { cookie: string }) {
  const cookie =
    (res.headers['set-cookie'] as unknown as string[] | undefined)
      ?.find((c) => c.startsWith('att_u='))
      ?.split(';')[0] ?? base.cookie;
  return {
    cookie,
    csrf: (res.body as { csrfToken: string }).csrfToken,
    body: res.body as Record<string, unknown>,
  };
}
