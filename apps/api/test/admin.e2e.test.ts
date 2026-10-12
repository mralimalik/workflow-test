import { randomUUID } from 'node:crypto';

import { generateSync } from 'otplib';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_PASSWORD, createAdmin, type AdminClient } from './support/admin';
import { as, linkToken, login, sessionCookie, signup, uniqueEmail } from './support/auth';
import { createTestApp, type TestApp } from './support/test-app';

const AUTH = '/v1/auth/admins';
const ADMIN = '/v1/admin';

/** Platform admins (plan A5, features/super-admin.md, FR-ADM-005/007, FR-AUTH-006). */
describe('platform admins', () => {
  let t: TestApp;
  let superAdmin: AdminClient;

  beforeAll(async () => {
    t = await createTestApp([], { withWorker: true });
    superAdmin = await createAdmin(t.app, t.server, 'super_admin');
  });
  afterAll(async () => {
    await t.close();
  });

  describe('realm isolation', () => {
    it('a user session is rejected on /admin and an admin session on user endpoints', async () => {
      const user = await signup(t.server);
      // The user's cookie is att_u; admin endpoints read att_a only.
      expect((await as(t.server, user).get(`${ADMIN}/feature-flags`)).status).toBe(401);
      // Even a user token presented under the admin cookie name is refused.
      const smuggled = user.cookie.replace(/^att_u=/, 'att_a=');
      expect(
        (await request(t.server).get(`${ADMIN}/feature-flags`).set('Cookie', smuggled)).status,
      ).toBe(401);
      expect((await request(t.server).get(`${AUTH}/session`).set('Cookie', smuggled)).status).toBe(
        401,
      );
      // And the admin session does not work on the users realm.
      const adminAsUser = superAdmin.cookie.replace(/^att_a=/, 'att_u=');
      expect(
        (await request(t.server).get('/v1/auth/users/session').set('Cookie', adminAsUser)).status,
      ).toBe(401);
      expect((await as(t.server, superAdmin).get(`${ADMIN}/feature-flags`)).status).toBe(200);
    });

    it('a user cannot log in to the admin realm with user credentials', async () => {
      const user = await signup(t.server);
      const res = await request(t.server)
        .post(`${AUTH}/login`)
        .send({ email: user.email, password: user.password });
      expect(res.status).toBe(401);
    });
  });

  describe('mandatory TOTP', () => {
    it('admin endpoints refuse the session until TOTP is set up; login then needs the code', async () => {
      const admin = await createAdmin(t.app, t.server, 'read_only', { enrollTotp: false });
      expect(admin.enrollmentRequired).toBe(true);
      const blocked = await as(t.server, admin).get(`${ADMIN}/feature-flags`);
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('mfa_enrollment_required');

      const enroll = await as(t.server, admin)
        .post(`${AUTH}/mfa/totp/enroll`)
        .send({ password: ADMIN_PASSWORD });
      const secret = enroll.body.secret as string;
      await as(t.server, admin)
        .post(`${AUTH}/mfa/totp/confirm`)
        .send({ code: generateSync({ secret }) });
      expect((await as(t.server, admin).get(`${ADMIN}/feature-flags`)).status).toBe(200);

      const again = await request(t.server)
        .post(`${AUTH}/login`)
        .send({ email: admin.email, password: ADMIN_PASSWORD });
      expect(again.body.status).toBe('mfa_required');
      expect(sessionCookie(again, 'att_a')).toBeUndefined();
      const verified = await request(t.server)
        .post(`${AUTH}/mfa/verify`)
        .send({
          mfaToken: again.body.mfaToken,
          code: generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 }),
        });
      expect(verified.status).toBe(200);
      expect(verified.body.admin).toMatchObject({ role: 'read_only', mfaEnabled: true });
      expect(sessionCookie(verified, 'att_a')).toMatch(/^att_a=.+/);
    });

    it('the admin session document and password reset by email go to the admin app', async () => {
      const session = await as(t.server, superAdmin).get(`${AUTH}/session`);
      expect(session.status).toBe(200);
      expect(session.body.admin).toMatchObject({ email: superAdmin.email, role: 'super_admin' });
      expect(session.body.mfaEnrollmentRequired).toBe(false);

      await request(t.server).post(`${AUTH}/password/forgot`).send({ email: superAdmin.email });
      const token = await linkToken(superAdmin.email, 'Reset your password');
      expect(token.length).toBeGreaterThan(20);
    });
  });

  describe('roles', () => {
    it('enforces each route’s allowed roles (super_admin may do everything)', async () => {
      const readOnly = await createAdmin(t.app, t.server, 'read_only');
      const billing = await createAdmin(t.app, t.server, 'billing');
      const support = await createAdmin(t.app, t.server, 'support');

      expect((await as(t.server, readOnly).get(`${ADMIN}/feature-flags`)).status).toBe(200);
      expect((await as(t.server, readOnly).get(`${ADMIN}/audit-logs`)).status).toBe(200);
      const denied = await as(t.server, readOnly)
        .post(`${ADMIN}/feature-flags`)
        .send({ key: 'test.denied', description: 'x', type: 'boolean', defaultValue: false });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('forbidden');
      expect((await as(t.server, readOnly).get(`${ADMIN}/admins`)).status).toBe(403);
      expect((await as(t.server, billing).get(`${ADMIN}/users`)).status).toBe(403);
      expect((await as(t.server, support).get(`${ADMIN}/users`)).status).toBe(200);
      expect((await as(t.server, support).get(`${ADMIN}/admins`)).status).toBe(403);
      expect((await as(t.server, superAdmin).get(`${ADMIN}/users`)).status).toBe(200);
    });
  });

  describe('users: search, ban, unban, revoke sessions (FR-AUTH-006)', () => {
    it('ban revokes the user’s sessions immediately and is audited', async () => {
      const support = await createAdmin(t.app, t.server, 'support');
      const user = await signup(t.server, { firstName: 'Zubair' });
      expect((await as(t.server, user).get('/v1/auth/users/session')).status).toBe(200);

      const search = await as(t.server, support).get(
        `${ADMIN}/users?q=${encodeURIComponent(user.email.toUpperCase())}`,
      );
      expect(search.body.data).toHaveLength(1);
      expect(search.body.data[0]).toMatchObject({ id: user.userId, status: 'active' });
      expect(
        (await as(t.server, support).get(`${ADMIN}/users?q=zubair`)).body.data.length,
      ).toBeGreaterThan(0);

      const ban = await as(t.server, support)
        .post(`${ADMIN}/users/${user.userId}/ban`)
        .send({ reason: 'Abuse report #42' });
      expect(ban.status).toBe(200);
      expect(ban.body).toMatchObject({ status: 'banned', banReason: 'Abuse report #42' });
      expect((await as(t.server, user).get('/v1/auth/users/session')).status).toBe(401);
      expect((await login(t.server, user.email, user.password)).body.code).toBe('account_disabled');
      expect(
        (
          await as(t.server, support)
            .post(`${ADMIN}/users/${user.userId}/ban`)
            .send({ reason: 'again please' })
        ).status,
      ).toBe(409);

      const audit = await as(t.server, superAdmin).get(
        `${ADMIN}/audit-logs?action=user.banned&targetId=${user.userId}`,
      );
      expect(audit.body.data).toEqual([
        expect.objectContaining({
          actorType: 'platform_admin',
          actorId: support.id,
          action: 'user.banned',
          targetId: user.userId,
        }),
      ]);

      const unban = await as(t.server, support)
        .post(`${ADMIN}/users/${user.userId}/unban`)
        .send({ reason: 'Appeal accepted' });
      expect(unban.body.status).toBe('active');
      expect((await login(t.server, user.email, user.password)).status).toBe(200);
    });

    it('signs a user out everywhere and shows their sessions', async () => {
      const user = await signup(t.server);
      await login(t.server, user.email, user.password);
      const detail = await as(t.server, superAdmin).get(`${ADMIN}/users/${user.userId}`);
      expect(detail.body.sessions).toHaveLength(2);
      const revoke = await as(t.server, superAdmin)
        .post(`${ADMIN}/users/${user.userId}/revoke-sessions`)
        .send({ reason: 'Suspicious activity' });
      expect(revoke.body).toEqual({ revoked: 2 });
      expect((await as(t.server, user).get('/v1/auth/users/session')).status).toBe(401);
      expect((await as(t.server, superAdmin).get(`${ADMIN}/users/${superAdmin.id}`)).status).toBe(
        404,
      );
    });

    it('paginates with an opaque cursor', async () => {
      for (let i = 0; i < 3; i++) await signup(t.server);
      const first = await as(t.server, superAdmin).get(`${ADMIN}/users?limit=2`);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.meta.hasMore).toBe(true);
      const second = await as(t.server, superAdmin).get(
        `${ADMIN}/users?limit=2&cursor=${first.body.meta.nextCursor as string}`,
      );
      const ids = [...first.body.data, ...second.body.data].map((u: { id: string }) => u.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect((await as(t.server, superAdmin).get(`${ADMIN}/users?cursor=garbage`)).status).toBe(
        422,
      );
    });
  });

  describe('admins', () => {
    it('invites an admin by email; the invitee sets a password and must enrol TOTP', async () => {
      const email = uniqueEmail('invitee');
      const created = await as(t.server, superAdmin)
        .post(`${ADMIN}/admins`)
        .set('Idempotency-Key', randomUUID())
        .send({ email, name: 'New Support', role: 'support' });
      expect(created.status).toBe(201);
      expect(created.body).toMatchObject({ email, role: 'support', mfaEnabled: false });

      const token = await linkToken(email, 'You have been added to the Attendra admin console');
      expect(
        (
          await request(t.server)
            .post(`${AUTH}/password/reset`)
            .send({ token, password: ADMIN_PASSWORD })
        ).status,
      ).toBe(204);
      const signedIn = await request(t.server)
        .post(`${AUTH}/login`)
        .send({ email, password: ADMIN_PASSWORD });
      expect(signedIn.body.mfaEnrollmentRequired).toBe(true);

      const dup = await as(t.server, superAdmin)
        .post(`${ADMIN}/admins`)
        .set('Idempotency-Key', randomUUID())
        .send({ email: email.toUpperCase(), name: 'Dup', role: 'support' });
      expect(dup.body.code).toBe('email_taken');
    });

    it('changes roles live, signs out disabled admins, and keeps one super admin', async () => {
      const support = await createAdmin(t.app, t.server, 'support');
      const promote = await as(t.server, superAdmin)
        .patch(`${ADMIN}/admins/${support.id}`)
        .send({ role: 'super_admin' });
      expect(promote.body.role).toBe('super_admin');
      // The role is effective on the very next request (cached sessions are refreshed).
      expect((await as(t.server, support).get(`${ADMIN}/admins`)).status).toBe(200);

      const disable = await as(t.server, superAdmin)
        .patch(`${ADMIN}/admins/${support.id}`)
        .send({ status: 'disabled' });
      expect(disable.body.status).toBe('disabled');
      expect((await as(t.server, support).get(`${AUTH}/session`)).status).toBe(401);

      // Every other super admin (other test admins included) is demoted; the last cannot be.
      const all = await as(t.server, superAdmin).get(`${ADMIN}/admins?limit=200`);
      for (const a of all.body.data as { id: string; role: string; status: string }[]) {
        if (a.id !== superAdmin.id && a.role === 'super_admin' && a.status === 'active') {
          await as(t.server, superAdmin).patch(`${ADMIN}/admins/${a.id}`).send({ role: 'support' });
        }
      }
      const last = await as(t.server, superAdmin)
        .patch(`${ADMIN}/admins/${superAdmin.id}`)
        .send({ role: 'support' });
      expect(last.status).toBe(409);
      expect(last.body.code).toBe('last_super_admin');
    });
  });

  describe('feature flags (FR-ADM-005)', () => {
    it('creates, updates and overrides flags with type checks; every change is audited', async () => {
      const key = `test.flag_${Date.now()}`;
      const create = await as(t.server, superAdmin)
        .post(`${ADMIN}/feature-flags`)
        .set('Idempotency-Key', randomUUID())
        .send({ key, description: 'Test flag', type: 'boolean', defaultValue: false });
      expect(create.status).toBe(201);
      const flagId = create.body.id as string;

      const wrongType = await as(t.server, superAdmin)
        .patch(`${ADMIN}/feature-flags/${flagId}`)
        .send({ defaultValue: 'yes' });
      expect(wrongType.status).toBe(422);
      const update = await as(t.server, superAdmin)
        .patch(`${ADMIN}/feature-flags/${flagId}`)
        .send({ rolloutPercent: 25 });
      expect(update.body.rolloutPercent).toBe(25);

      const user = await signup(t.server);
      const override = await as(t.server, superAdmin)
        .post(`${ADMIN}/feature-flags/${flagId}/overrides`)
        .send({ scopeType: 'user', scopeId: user.userId, value: true });
      expect(override.status).toBe(200);
      expect(override.body.setByPlatformAdminId).toBe(superAdmin.id);
      const list = await as(t.server, superAdmin).get(`${ADMIN}/feature-flags/${flagId}/overrides`);
      expect(list.body.data).toHaveLength(1);
      expect(
        (
          await as(t.server, superAdmin).delete(
            `${ADMIN}/feature-flags/${flagId}/overrides/${override.body.id as string}`,
          )
        ).status,
      ).toBe(204);

      const audit = await as(t.server, superAdmin).get(
        `${ADMIN}/audit-logs?targetType=feature_flag&targetId=${flagId}`,
      );
      expect((audit.body.data as { action: string }[]).map((e) => e.action)).toEqual([
        'feature_flag.override_removed',
        'feature_flag.override_set',
        'feature_flag.updated',
        'feature_flag.created',
      ]);
    });
  });
});
