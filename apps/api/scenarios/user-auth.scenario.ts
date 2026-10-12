import { randomUUID } from 'node:crypto';

import { generateSync } from 'otplib';

import { waitForEmail } from '../../../test/mailpit';
import { defineScenario } from './lib/scenario';

const BASE = '/v1/auth/users';

async function tokenFromEmail(to: string, subject: string): Promise<string> {
  const mail = await waitForEmail(to, 20_000, { subject });
  const token = /token=([A-Za-z0-9_-]+)/.exec(mail.text)?.[1];
  if (!token) throw new Error(`No link in the "${subject}" email`);
  return token;
}

/** A TOTP code for a time step after the current one (each step is accepted once). */
const totp = (secret: string, step: number) =>
  generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 * step });

/**
 * Plan A4 scenario: signup → verify → login → enable 2FA → login with 2FA → reset password.
 * Needs the api and the worker running (emails go through Mailpit).
 */
export default defineScenario({
  id: 'user-auth',
  title: 'User auth: signup → verify email → login → 2FA → reset password',
  requirements: ['FR-AUTH-001', 'FR-AUTH-002', 'FR-AUTH-003', 'FR-AUTH-005', 'NFR-SEC-002'],
  async run(ctx) {
    const email = `scenario-${randomUUID()}@example.test`;
    const password = 'violet harbour lantern 42';

    const signup = await ctx.request('Sign up', 'POST', `${BASE}/signup`, {
      body: { email, password, firstName: 'Sana', lastName: 'Iqbal', timezone: 'Asia/Karachi' },
      expectStatus: 201,
    });
    let csrf = (signup.body as { csrfToken: string }).csrfToken;
    ctx.check(
      'email starts unverified',
      !(signup.body as { user: { emailVerified: boolean } }).user.emailVerified,
    );

    await ctx.request('Verify email with the emailed link', 'POST', `${BASE}/email/verify`, {
      body: { token: await tokenFromEmail(email, 'Confirm your email address') },
      expectStatus: 204,
    });
    const me = await ctx.request('Session shows the verified email', 'GET', `${BASE}/session`, {
      expectStatus: 200,
    });
    ctx.check(
      'emailVerified is true',
      (me.body as { user: { emailVerified: boolean } }).user.emailVerified,
    );

    await ctx.request('Log out', 'POST', `${BASE}/logout`, {
      headers: { 'X-CSRF-Token': csrf },
      expectStatus: 204,
    });
    const login = await ctx.request('Log in with email and password', 'POST', `${BASE}/login`, {
      body: { email, password },
      expectStatus: 200,
    });
    csrf = (login.body as { csrfToken: string }).csrfToken;

    const enroll = await ctx.request('Start TOTP setup', 'POST', `${BASE}/mfa/totp/enroll`, {
      headers: { 'X-CSRF-Token': csrf },
      body: { password },
      expectStatus: 200,
    });
    const secret = (enroll.body as { secret: string }).secret;
    const confirm = await ctx.request(
      'Confirm TOTP with a code',
      'POST',
      `${BASE}/mfa/totp/confirm`,
      {
        headers: { 'X-CSRF-Token': csrf },
        body: { code: totp(secret, 0) },
        expectStatus: 200,
      },
    );
    ctx.check(
      '10 recovery codes issued',
      (confirm.body as { recoveryCodes: string[] }).recoveryCodes.length === 10,
    );

    await ctx.request('Log out', 'POST', `${BASE}/logout`, {
      headers: { 'X-CSRF-Token': csrf },
      expectStatus: 204,
    });
    const first = await ctx.request('Log in: second factor required', 'POST', `${BASE}/login`, {
      body: { email, password },
      expectStatus: 200,
    });
    const pending = first.body as { status: string; mfaToken: string };
    ctx.check('status is mfa_required', pending.status === 'mfa_required');
    const verified = await ctx.request(
      'Complete login with a TOTP code',
      'POST',
      `${BASE}/mfa/verify`,
      {
        body: { mfaToken: pending.mfaToken, code: totp(secret, 1) },
        expectStatus: 200,
      },
    );
    ctx.check(
      'session is MFA-verified',
      (verified.body as { session: { mfaVerified: boolean } }).session.mfaVerified,
    );

    await ctx.request('Request a password reset', 'POST', `${BASE}/password/forgot`, {
      body: { email },
      expectStatus: 202,
    });
    const newPassword = 'emerald canyon whistle 7';
    const token = await tokenFromEmail(email, 'Reset your password');
    await ctx.request(
      'Reset the password with the emailed link',
      'POST',
      `${BASE}/password/reset`,
      {
        body: { token, password: newPassword },
        expectStatus: 204,
      },
    );
    await ctx.request('The reset link is single use', 'POST', `${BASE}/password/reset`, {
      body: { token, password: 'another long password 9' },
      expectStatus: 400,
    });
    await ctx.request('Old session was signed out', 'GET', `${BASE}/session`, {
      expectStatus: 401,
    });
    await ctx.request('Old password no longer works', 'POST', `${BASE}/login`, {
      body: { email, password },
      expectStatus: 401,
    });
    const relogin = await ctx.request('Log in with the new password', 'POST', `${BASE}/login`, {
      body: { email, password: newPassword },
      expectStatus: 200,
    });
    ctx.check(
      'second factor still required',
      (relogin.body as { status: string }).status === 'mfa_required',
    );
  },
});
