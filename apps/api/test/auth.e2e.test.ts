import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { waitForEmail } from '../../../test/mailpit';
import {
  as,
  CHROME_MAC,
  clientFrom,
  linkToken,
  login,
  sessionCookie,
  signup,
  STRONG_PASSWORD,
  totp,
  uniqueEmail,
  type UserClient,
} from './support/auth';
import { createTestApp, type TestApp } from './support/test-app';

const BASE = '/v1/auth/users';
const VERIFY_SUBJECT = 'Confirm your email address';
const RESET_SUBJECT = 'Reset your password';

/**
 * Business-user authentication, end to end through the api and the worker (emails via
 * Mailpit). Covers every row of the auth endpoint table for the `users` realm (plan A4).
 */
describe('user authentication (FR-AUTH, plan A4)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp([], { withWorker: true });
  });
  afterAll(async () => {
    await t.close();
  });

  describe('signup and email verification', () => {
    it('FR-AUTH-001 signs up, sets a hardened session cookie and returns the session document', async () => {
      const email = uniqueEmail('signup');
      const res = await request(t.server)
        .post(`${BASE}/signup`)
        .send({ email: email.toUpperCase(), password: STRONG_PASSWORD, firstName: 'Ana' });
      expect(res.status).toBe(201);
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
        c.startsWith('att_u='),
      );
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(cookie).toMatch(/Path=\//);
      expect(res.body).toMatchObject({
        user: { email, emailVerified: false, firstName: 'Ana', mfaEnabled: false, locale: 'en' },
        session: { authMethod: 'password', mfaVerified: false },
        mfaEnrollmentRequired: false,
      });
      expect(typeof res.body.csrfToken).toBe('string');
    });

    it('rejects a taken email (case-insensitive) and weak or breached passwords', async () => {
      const first = await signup(t.server);
      const dup = await request(t.server)
        .post(`${BASE}/signup`)
        .send({ email: first.email.toUpperCase(), password: STRONG_PASSWORD, firstName: 'B' });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('email_taken');

      const short = await request(t.server)
        .post(`${BASE}/signup`)
        .send({ email: uniqueEmail(), password: 'short', firstName: 'B' });
      expect(short.status).toBe(422);

      const breached = await request(t.server)
        .post(`${BASE}/signup`)
        .send({ email: uniqueEmail(), password: 'Password123', firstName: 'B' });
      expect(breached.status).toBe(422);
      expect(breached.body.errors).toEqual([
        expect.objectContaining({ path: 'password', code: 'password_breached' }),
      ]);
    });

    it('verifies the email from the link (single use) and resends only while unverified', async () => {
      const user = await signup(t.server);
      const token = await linkToken(user.email, VERIFY_SUBJECT);

      const verify = await request(t.server).post(`${BASE}/email/verify`).send({ token });
      expect(verify.status).toBe(204);
      const reuse = await request(t.server).post(`${BASE}/email/verify`).send({ token });
      expect(reuse.status).toBe(400);
      expect(reuse.body.code).toBe('token_invalid');

      const session = await as(t.server, user).get(`${BASE}/session`);
      expect(session.body.user.emailVerified).toBe(true);
      expect((await as(t.server, user).post(`${BASE}/email/resend`)).status).toBe(202);
    });

    it('resends a working verification link', async () => {
      const user = await signup(t.server);
      await linkToken(user.email, VERIFY_SUBJECT);
      expect((await as(t.server, user).post(`${BASE}/email/resend`)).status).toBe(202);
      // Both links stay valid until one is used.
      const res = await fetchAllTokens(user.email, VERIFY_SUBJECT, 2);
      expect(
        (await request(t.server).post(`${BASE}/email/verify`).send({ token: res[0] })).status,
      ).toBe(204);
    });
  });

  describe('login, session and logout', () => {
    it('logs in, bootstraps the session and logs out (CSRF required)', async () => {
      const user = await signup(t.server);
      const wrong = await login(t.server, user.email, 'not the password');
      expect(wrong.status).toBe(401);
      expect(wrong.body.code).toBe('invalid_credentials');
      const unknown = await login(t.server, uniqueEmail(), 'whatever-password');
      expect(unknown.status).toBe(401);
      expect(unknown.body.code).toBe('invalid_credentials');

      const res = await login(t.server, user.email, user.password);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('authenticated');
      const client = clientFrom(res, user);

      const session = await as(t.server, client).get(`${BASE}/session`);
      expect(session.status).toBe(200);
      expect(session.body.session.id).toBe(client.sessionId);
      expect(session.body.csrfToken).toBe(client.csrf);

      expect((await request(t.server).get(`${BASE}/session`)).body.code).toBe('unauthenticated');
      expect(
        (
          await request(t.server)
            .get(`${BASE}/session`)
            .set('Cookie', `att_u=${'x'.repeat(43)}`)
        ).status,
      ).toBe(401);

      const noCsrf = await request(t.server).post(`${BASE}/logout`).set('Cookie', client.cookie);
      expect(noCsrf.status).toBe(403);
      expect(noCsrf.body.code).toBe('csrf_token_invalid');
      const badCsrf = await request(t.server)
        .post(`${BASE}/logout`)
        .set('Cookie', client.cookie)
        .set('X-CSRF-Token', 'forged');
      expect(badCsrf.status).toBe(403);

      const logout = await as(t.server, client).post(`${BASE}/logout`);
      expect(logout.status).toBe(204);
      expect(sessionCookie(logout)).toBe('att_u=');
      expect((await as(t.server, client).get(`${BASE}/session`)).status).toBe(401);
    });

    it('lists sessions and revokes one immediately — the very next request is refused', async () => {
      const user = await signup(t.server);
      const other = clientFrom(await login(t.server, user.email, user.password, CHROME_MAC), user);
      // Warm the other session's cache entry first.
      expect((await as(t.server, other).get(`${BASE}/session`)).status).toBe(200);

      const list = await as(t.server, user).get(`${BASE}/sessions`);
      expect(list.status).toBe(200);
      const listed = list.body.data as { id: string; current: boolean; deviceLabel: string }[];
      expect(listed).toHaveLength(2);
      expect(listed.find((s) => s.current)?.id).toBe(user.sessionId);
      expect(listed.find((s) => s.id === other.sessionId)?.deviceLabel).toBe('Chrome on macOS');

      const revoke = await as(t.server, user).delete(`${BASE}/sessions/${other.sessionId}`);
      expect(revoke.status).toBe(204);
      expect((await as(t.server, other).get(`${BASE}/session`)).status).toBe(401);
      expect((await as(t.server, user).delete(`${BASE}/sessions/${other.sessionId}`)).status).toBe(
        404,
      );
    });

    it('cannot revoke another user’s session', async () => {
      const a = await signup(t.server);
      const b = await signup(t.server);
      expect((await as(t.server, a).delete(`${BASE}/sessions/${b.sessionId}`)).status).toBe(404);
      expect((await as(t.server, b).get(`${BASE}/session`)).status).toBe(200);
    });

    it('signs out every other session', async () => {
      const user = await signup(t.server);
      const second = clientFrom(await login(t.server, user.email, user.password), user);
      const third = clientFrom(await login(t.server, user.email, user.password), user);
      const res = await as(t.server, user).post(`${BASE}/sessions/revoke-others`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ revoked: 2 });
      expect((await as(t.server, second).get(`${BASE}/session`)).status).toBe(401);
      expect((await as(t.server, third).get(`${BASE}/session`)).status).toBe(401);
      expect((await as(t.server, user).get(`${BASE}/session`)).status).toBe(200);
    });

    it('emails a new-device sign-in alert', async () => {
      const user = await signup(t.server);
      await login(t.server, user.email, user.password, CHROME_MAC);
      const mail = await waitForEmail(user.email, 15_000, {
        subject: 'New sign-in to your Attendra account',
      });
      expect(mail.text).toContain('Chrome on macOS');
    });
  });

  describe('passwords', () => {
    it('resets the password with a single-use link and signs out every session', async () => {
      const user = await signup(t.server);
      const unknown = await request(t.server)
        .post(`${BASE}/password/forgot`)
        .send({ email: uniqueEmail('nobody') });
      expect(unknown.status).toBe(202);

      expect(
        (await request(t.server).post(`${BASE}/password/forgot`).send({ email: user.email }))
          .status,
      ).toBe(202);
      const token = await linkToken(user.email, RESET_SUBJECT);

      const weak = await request(t.server)
        .post(`${BASE}/password/reset`)
        .send({ token, password: 'short' });
      expect(weak.status).toBe(422);

      const newPassword = 'emerald canyon whistle 7';
      const reset = await request(t.server)
        .post(`${BASE}/password/reset`)
        .send({ token, password: newPassword });
      expect(reset.status).toBe(204);
      const reuse = await request(t.server)
        .post(`${BASE}/password/reset`)
        .send({ token, password: 'another long password 9' });
      expect(reuse.status).toBe(400);
      expect(reuse.body.code).toBe('token_invalid');

      expect((await as(t.server, user).get(`${BASE}/session`)).status).toBe(401);
      expect((await login(t.server, user.email, user.password)).status).toBe(401);
      const relogin = await login(t.server, user.email, newPassword);
      expect(relogin.status).toBe(200);
      // The link proved control of the mailbox.
      expect(relogin.body.user.emailVerified).toBe(true);
    });

    it('changes the password after re-authentication and signs out other sessions only', async () => {
      const user = await signup(t.server);
      const other = clientFrom(await login(t.server, user.email, user.password), user);

      const wrong = await as(t.server, user)
        .post(`${BASE}/password/change`)
        .send({ currentPassword: 'nope nope nope', newPassword: 'emerald canyon whistle 7' });
      expect(wrong.status).toBe(403);
      expect(wrong.body.code).toBe('reauthentication_failed');

      const ok = await as(t.server, user)
        .post(`${BASE}/password/change`)
        .send({ currentPassword: user.password, newPassword: 'emerald canyon whistle 7' });
      expect(ok.status).toBe(204);
      expect((await as(t.server, user).get(`${BASE}/session`)).status).toBe(200);
      expect((await as(t.server, other).get(`${BASE}/session`)).status).toBe(401);
      expect((await login(t.server, user.email, 'emerald canyon whistle 7')).status).toBe(200);
    });
  });

  describe('two-factor authentication (TOTP)', () => {
    async function enable(user: UserClient): Promise<{ secret: string; recoveryCodes: string[] }> {
      const enroll = await as(t.server, user)
        .post(`${BASE}/mfa/totp/enroll`)
        .send({ password: user.password });
      expect(enroll.status).toBe(200);
      const secret = enroll.body.secret as string;
      expect(enroll.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Attendra/);
      const confirm = await as(t.server, user)
        .post(`${BASE}/mfa/totp/confirm`)
        .send({ code: await totp(secret, 0) });
      expect(confirm.status).toBe(200);
      return { secret, recoveryCodes: confirm.body.recoveryCodes as string[] };
    }

    it('FR-AUTH-005 enrols, requires the second factor at login and rejects replays', async () => {
      const user = await signup(t.server);
      const wrongPassword = await as(t.server, user)
        .post(`${BASE}/mfa/totp/enroll`)
        .send({ password: 'wrong wrong wrong' });
      expect(wrongPassword.status).toBe(403);

      const enroll = await as(t.server, user)
        .post(`${BASE}/mfa/totp/enroll`)
        .send({ password: user.password });
      const badConfirm = await as(t.server, user)
        .post(`${BASE}/mfa/totp/confirm`)
        .send({ code: '000000' });
      expect(badConfirm.status).toBe(401);
      expect(badConfirm.body.code).toBe('mfa_code_invalid');
      const confirm = await as(t.server, user)
        .post(`${BASE}/mfa/totp/confirm`)
        .send({ code: await totp(enroll.body.secret as string, 0) });
      expect(confirm.status).toBe(200);
      expect(confirm.body.recoveryCodes).toHaveLength(10);
      const secret = enroll.body.secret as string;

      const me = await as(t.server, user).get(`${BASE}/session`);
      expect(me.body.user.mfaEnabled).toBe(true);
      expect(me.body.session.mfaVerified).toBe(true);
      expect(
        (await as(t.server, user).post(`${BASE}/mfa/totp/enroll`).send({ password: user.password }))
          .body.code,
      ).toBe('mfa_already_enabled');

      const first = await login(t.server, user.email, user.password);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        status: 'mfa_required',
        methods: ['totp', 'recovery_code'],
      });
      expect(sessionCookie(first)).toBeUndefined();

      const wrongCode = await request(t.server)
        .post(`${BASE}/mfa/verify`)
        .send({ mfaToken: first.body.mfaToken, code: '123456' });
      expect(wrongCode.status).toBe(401);

      const code = await totp(secret, 1);
      const verified = await request(t.server)
        .post(`${BASE}/mfa/verify`)
        .send({ mfaToken: first.body.mfaToken, code });
      expect(verified.status).toBe(200);
      expect(verified.body.session.mfaVerified).toBe(true);
      expect(sessionCookie(verified)).toMatch(/^att_u=.+/);

      // The login token is single use, and the same code cannot be replayed.
      const tokenReuse = await request(t.server)
        .post(`${BASE}/mfa/verify`)
        .send({ mfaToken: first.body.mfaToken, code });
      expect(tokenReuse.body.code).toBe('token_invalid');
      const second = await login(t.server, user.email, user.password);
      const replay = await request(t.server)
        .post(`${BASE}/mfa/verify`)
        .send({ mfaToken: second.body.mfaToken, code });
      expect(replay.status).toBe(401);
      expect(replay.body.code).toBe('mfa_code_invalid');
    });

    it('accepts each recovery code once', async () => {
      const user = await signup(t.server);
      const { recoveryCodes } = await enable(user);
      const recoveryCode = recoveryCodes[0]?.toLowerCase();

      const first = await login(t.server, user.email, user.password);
      const ok = await request(t.server)
        .post(`${BASE}/mfa/verify`)
        .send({ mfaToken: first.body.mfaToken, recoveryCode });
      expect(ok.status).toBe(200);

      const second = await login(t.server, user.email, user.password);
      const reuse = await request(t.server)
        .post(`${BASE}/mfa/verify`)
        .send({ mfaToken: second.body.mfaToken, recoveryCode });
      expect(reuse.status).toBe(401);
    });

    it('a pending login token dies after 5 wrong codes', async () => {
      const user = await signup(t.server);
      await enable(user);
      const pending = await login(t.server, user.email, user.password);
      for (let i = 0; i < 5; i++) {
        await request(t.server)
          .post(`${BASE}/mfa/verify`)
          .send({ mfaToken: pending.body.mfaToken, code: '000000' });
      }
      const after = await request(t.server)
        .post(`${BASE}/mfa/verify`)
        .send({ mfaToken: pending.body.mfaToken, code: '000000' });
      expect(after.body.code).toBe('token_invalid');
    });

    it('disables TOTP with the password', async () => {
      const user = await signup(t.server);
      await enable(user);
      expect(
        (
          await as(t.server, user)
            .post(`${BASE}/mfa/totp/disable`)
            .send({ password: 'wrong wrong wrong' })
        ).status,
      ).toBe(403);
      expect(
        (
          await as(t.server, user)
            .post(`${BASE}/mfa/totp/disable`)
            .send({ password: user.password })
        ).status,
      ).toBe(204);
      expect((await login(t.server, user.email, user.password)).body.status).toBe('authenticated');
      expect(
        (
          await as(t.server, user)
            .post(`${BASE}/mfa/totp/disable`)
            .send({ password: user.password })
        ).body.code,
      ).toBe('mfa_not_enabled');
    });
  });

  describe('abuse controls', () => {
    it('the 11th login attempt within 15 minutes is refused with 429', async () => {
      const user = await signup(t.server);
      for (let i = 0; i < 10; i++) {
        expect((await login(t.server, user.email, `wrong password ${i}`)).status).toBe(401);
      }
      const eleventh = await login(t.server, user.email, user.password);
      expect(eleventh.status).toBe(429);
      expect(eleventh.body.code).toBe('rate_limited');
      expect(Number(eleventh.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('locks the account after 10 failures even when they come from different IPs', async () => {
      const user = await signup(t.server);
      for (let i = 0; i < 10; i++) {
        const res = await request(t.server)
          .post(`${BASE}/login`)
          .set('X-Forwarded-For', `203.0.113.${i + 1}`)
          .send({ email: user.email, password: `wrong password ${i}` });
        expect(res.status).toBe(401);
      }
      const locked = await request(t.server)
        .post(`${BASE}/login`)
        .set('X-Forwarded-For', '198.51.100.7')
        .send({ email: user.email, password: user.password });
      expect(locked.status).toBe(429);
    });
  });

  describe('account profile', () => {
    it('reads and updates the profile', async () => {
      const user = await signup(t.server);
      const get = await as(t.server, user).get(`${BASE}/account`);
      expect(get.status).toBe(200);
      expect(get.body).toMatchObject({ id: user.userId, firstName: 'Ana', avatar: null });

      const patch = await as(t.server, user).patch(`${BASE}/account`).send({
        firstName: 'Ana María',
        lastName: 'López',
        timezone: 'Asia/Karachi',
        locale: 'ur-pk',
      });
      expect(patch.status).toBe(200);
      expect(patch.body).toMatchObject({
        firstName: 'Ana María',
        lastName: 'López',
        timezone: 'Asia/Karachi',
        locale: 'ur-PK',
      });

      const bad = await as(t.server, user).patch(`${BASE}/account`).send({ timezone: '+05:00' });
      expect(bad.status).toBe(422);
      const empty = await as(t.server, user).patch(`${BASE}/account`).send({});
      expect(empty.status).toBe(422);
      const noCsrf = await request(t.server)
        .patch(`${BASE}/account`)
        .set('Cookie', user.cookie)
        .send({ firstName: 'X' });
      expect(noCsrf.status).toBe(403);
    });

    it('uploads an avatar through a signed URL and attaches only the user’s own file', async () => {
      const PNG = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64',
      );
      const user = await signup(t.server);
      const upload = await as(t.server, user)
        .post(`${BASE}/account/avatar`)
        .send({ contentType: 'image/png', sizeBytes: PNG.length });
      expect(upload.status).toBe(201);
      const put = await request(t.server)
        .put(new URL(upload.body.upload.url as string).pathname)
        .set('Content-Type', 'image/png')
        .send(PNG);
      expect(put.status).toBe(200);

      const other = await signup(t.server);
      const stolen = await as(t.server, other)
        .patch(`${BASE}/account`)
        .send({ avatarFileId: upload.body.fileId });
      expect(stolen.status).toBe(404);

      const attach = await as(t.server, user)
        .patch(`${BASE}/account`)
        .send({ avatarFileId: upload.body.fileId });
      expect(attach.status).toBe(200);
      expect(attach.body.avatar.fileId).toBe(upload.body.fileId);
      const image = await request(t.server).get(new URL(attach.body.avatar.url as string).pathname);
      expect(image.status).toBe(200);
      expect(image.headers['content-type']).toBe('image/png');
    });
  });
});

/** Waits until `count` emails with this subject reached the inbox; returns their tokens. */
async function fetchAllTokens(to: string, subject: string, count: number): Promise<string[]> {
  const base =
    process.env['MAILPIT_API_URL'] ?? `http://${process.env['SMTP_HOST'] ?? 'localhost'}:8025`;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const query = encodeURIComponent(`to:"${to}" subject:"${subject}"`);
    const list = (await (await fetch(`${base}/api/v1/search?query=${query}`)).json()) as {
      messages: { ID: string }[];
    };
    if (list.messages.length >= count) {
      const tokens: string[] = [];
      for (const m of list.messages) {
        const full = (await (await fetch(`${base}/api/v1/message/${m.ID}`)).json()) as {
          Text: string;
        };
        const match = /token=([A-Za-z0-9_-]+)/.exec(full.Text);
        if (match?.[1]) tokens.push(match[1]);
      }
      return tokens;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Expected ${count} "${subject}" emails to ${to}`);
}
