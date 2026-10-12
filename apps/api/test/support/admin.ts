import type { Server } from 'node:http';

import type { AdminRole } from '@attendra/contracts';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AdminAdminsService } from '@attendra/server/modules/admin/admin.public';
import { generateSync } from 'otplib';
import request from 'supertest';

import { as, sessionCookie, uniqueEmail } from './auth';

export const ADMIN_PASSWORD = 'granite meadow compass 88';
const BASE = '/v1/auth/admins';

export interface AdminClient {
  id: string;
  email: string;
  cookie: string;
  csrf: string;
  secret: string;
}

/** Creates an admin like the CLI does, sets the password from the link and signs in. */
export async function createAdmin(
  app: NestExpressApplication,
  server: Server,
  role: AdminRole,
  options: { enrollTotp?: boolean } = {},
): Promise<AdminClient & { enrollmentRequired: boolean }> {
  const email = uniqueEmail(`admin-${role}`);
  const { admin, link } = await app
    .get(AdminAdminsService)
    .createWithLink({ email, name: `Admin ${role}`, role });
  const token = new URL(link).searchParams.get('token') ?? '';
  const reset = await request(server)
    .post(`${BASE}/password/reset`)
    .send({ token, password: ADMIN_PASSWORD });
  if (reset.status !== 204) throw new Error(`reset failed ${reset.status}`);

  const login = await request(server)
    .post(`${BASE}/login`)
    .send({ email, password: ADMIN_PASSWORD });
  if (login.status !== 200)
    throw new Error(`login failed ${login.status} ${JSON.stringify(login.body)}`);
  const client = {
    id: admin.id,
    email,
    cookie: sessionCookie(login, 'att_a') ?? '',
    csrf: (login.body as { csrfToken: string }).csrfToken,
    secret: '',
    enrollmentRequired: (login.body as { mfaEnrollmentRequired: boolean }).mfaEnrollmentRequired,
  };
  if (options.enrollTotp === false) return client;

  const enroll = await as(server, client)
    .post(`${BASE}/mfa/totp/enroll`)
    .send({ password: ADMIN_PASSWORD });
  client.secret = enroll.body.secret as string;
  const confirm = await as(server, client)
    .post(`${BASE}/mfa/totp/confirm`)
    .send({ code: generateSync({ secret: client.secret }) });
  if (confirm.status !== 200) throw new Error(`totp confirm failed ${confirm.status}`);
  return client;
}
