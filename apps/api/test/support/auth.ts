import type { Server } from 'node:http';

import { newId } from '@attendra/server/kernel/ids/ids';
import { generate } from 'otplib';
import request, { type Response } from 'supertest';

import { waitForEmail } from '../../../../test/mailpit';

export const CHROME_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
export const FIREFOX_WIN =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0';

/** A browser-like client: the session cookie plus its CSRF token. */
export interface UserClient {
  cookie: string;
  csrf: string;
  userId: string;
  sessionId: string;
  email: string;
  password: string;
}

/** The `att_u=…` pair from a response's Set-Cookie, or undefined. */
export function sessionCookie(res: Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith('att_u='))?.split(';')[0];
}

export function uniqueEmail(tag = 'user'): string {
  return `${tag}-${newId()}@example.test`;
}

export const STRONG_PASSWORD = 'violet harbour lantern 42';

export async function signup(
  server: Server,
  overrides: Partial<{ email: string; password: string; firstName: string }> = {},
): Promise<UserClient & { body: Record<string, unknown> }> {
  const email = overrides.email ?? uniqueEmail();
  const password = overrides.password ?? STRONG_PASSWORD;
  const res = await request(server)
    .post('/v1/auth/users/signup')
    .send({ email, password, firstName: overrides.firstName ?? 'Ana', locale: 'en-GB' });
  if (res.status !== 201)
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as { user: { id: string }; session: { id: string }; csrfToken: string };
  return {
    cookie: sessionCookie(res) ?? '',
    csrf: body.csrfToken,
    userId: body.user.id,
    sessionId: body.session.id,
    email,
    password,
    body: res.body as Record<string, unknown>,
  };
}

export async function login(
  server: Server,
  email: string,
  password: string,
  userAgent?: string,
): Promise<Response> {
  const req = request(server).post('/v1/auth/users/login');
  if (userAgent) void req.set('User-Agent', userAgent);
  return req.send({ email, password });
}

export function clientFrom(
  res: Response,
  base: Pick<UserClient, 'email' | 'password'>,
): UserClient {
  const body = res.body as { user: { id: string }; session: { id: string }; csrfToken: string };
  return {
    ...base,
    cookie: sessionCookie(res) ?? '',
    csrf: body.csrfToken,
    userId: body.user.id,
    sessionId: body.session.id,
  };
}

/** Authenticated request helpers carrying the cookie (and the CSRF token on writes). */
export function as(server: Server, client: Pick<UserClient, 'cookie' | 'csrf'>) {
  const write = (r: request.Test) =>
    r.set('Cookie', client.cookie).set('X-CSRF-Token', client.csrf);
  return {
    get: (path: string) => request(server).get(path).set('Cookie', client.cookie),
    post: (path: string) => write(request(server).post(path)),
    patch: (path: string) => write(request(server).patch(path)),
    delete: (path: string) => write(request(server).delete(path)),
  };
}

/** The `token` query parameter of the link in the newest matching email. */
export async function linkToken(to: string, subject: string): Promise<string> {
  const mail = await waitForEmail(to, 15_000, { subject });
  const match = /token=([A-Za-z0-9_-]+)/.exec(mail.text);
  if (!match?.[1]) throw new Error(`No link token in "${subject}" email`);
  return match[1];
}

/** A TOTP code for the next time step (the current one may already be used). */
export function totp(secret: string, stepOffset = 1): Promise<string> {
  return generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 * stepOffset });
}
