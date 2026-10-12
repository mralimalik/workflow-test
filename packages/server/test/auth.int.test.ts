import type { INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { generateSync } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { WorkerModule } from '../src/apps/worker.module';
import { Database } from '../src/kernel/db/database';
import { newId } from '../src/kernel/ids/ids';
import {
  ChallengeCleanupTask,
  SessionCleanupTask,
} from '../src/modules/auth/application/auth-cleanup.task';
import { ChallengeService } from '../src/modules/auth/application/challenge.service';
import { MfaService } from '../src/modules/auth/application/mfa.service';
import { SessionService } from '../src/modules/auth/application/session.service';
import type { AuthSubject } from '../src/modules/auth/application/subjects';
import { SessionCache } from '../src/modules/auth/infrastructure/session-cache';
import { UsersService } from '../src/modules/users/users.public';
import { LogSink } from './support/log-sink';

let app: INestApplicationContext;
let db: Database;
let users: UsersService;
let sessions: SessionService;
let cache: SessionCache;
let challenges: ChallengeService;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [WorkerModule.forRoot({ logDestination: new LogSink() })],
  }).compile();
  await moduleRef.init();
  app = moduleRef;
  db = app.get(Database);
  users = app.get(UsersService);
  sessions = app.get(SessionService, { strict: false });
  cache = app.get(SessionCache, { strict: false });
  challenges = app.get(ChallengeService, { strict: false });
});
afterAll(async () => {
  await app.close();
});

async function newUser(): Promise<AuthSubject> {
  const user = await db.transaction((tx) =>
    users.create(tx, { email: `int-${newId()}@example.test`, passwordHash: null, firstName: 'I' }),
  );
  return {
    id: user.id,
    realm: 'user',
    email: user.email,
    status: 'active',
    sessionVersion: 1,
    mfaRequired: false,
    role: null,
  };
}

describe('sessions: storage and revocation (BACKEND.md §6.2)', () => {
  it('stores only the SHA-256 of the token and resolves through the cache', async () => {
    const subject = await newUser();
    const { token, row } = await db.transaction((tx) =>
      sessions.create(tx, { subject, authMethod: 'password', mfaVerified: false }),
    );
    const { rows } = await db.transaction((tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from sessions where token_hash = ${Buffer.from(token)}`,
      ),
    );
    expect(rows[0]?.n).toBe(0);
    const resolved = await sessions.resolve('user', token);
    expect(resolved.id).toBe(row.id);
    expect(await cache.get(resolved.tokenHash)).toMatchObject({ id: row.id });
    // The wrong realm never matches, even with a valid token.
    await expect(sessions.resolve('platform_admin', token)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('a load racing a revoke cannot write the revoked session back into the cache', async () => {
    const subject = await newUser();
    const { token } = await db.transaction((tx) =>
      sessions.create(tx, { subject, authMethod: 'password', mfaVerified: false }),
    );
    const live = await sessions.resolve('user', token);
    const stale = await cache.get(live.tokenHash);
    await db.transaction((tx) =>
      sessions.revokeInTx(tx, { realm: 'user', subjectId: subject.id }, 'logout_all'),
    );
    // A loader that read the row before the revoke now tries to cache it.
    await cache.put(live.tokenHash, stale!, 60_000);
    expect(await cache.get(live.tokenHash)).toBeNull();
    await expect(sessions.resolve('user', token)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses sessions whose subject version moved on (bans) or that were revoked', async () => {
    const subject = await newUser();
    const { token } = await db.transaction((tx) =>
      sessions.create(tx, { subject, authMethod: 'password', mfaVerified: false }),
    );
    await db.transaction((tx) => users.bumpSessionVersion(tx, subject.id));
    await expect(sessions.resolve('user', token)).rejects.toMatchObject({ status: 401 });
    const { rows } = await db.transaction((tx) =>
      tx.execute<{ revoke_reason: string }>(
        sql`select revoke_reason from sessions where subject_id = ${subject.id}`,
      ),
    );
    expect(rows[0]?.revoke_reason).toBe('admin');
  });
});

describe('one-time links (FR-AUTH-003)', () => {
  it('stores only a peppered hash and lets exactly one of two concurrent uses succeed', async () => {
    const subject = await newUser();
    const { token, challenge } = await db.transaction((tx) =>
      challenges.createLink(tx, {
        realm: 'user',
        purpose: 'password_reset',
        subjectId: subject.id,
        destination: subject.email!,
      }),
    );
    expect(challenge.secretHash.toString('base64url')).not.toBe(token);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        db.transaction((tx) =>
          challenges.consumeLink(tx, { realm: 'user', purpose: 'password_reset', token }),
        ),
      ),
    );
    expect(results.filter((r) => r !== null)).toHaveLength(1);
  });

  it('a link only works for its own purpose and realm, and using one closes the others', async () => {
    const subject = await newUser();
    const mint = () =>
      db.transaction((tx) =>
        challenges.createLink(tx, {
          realm: 'user',
          purpose: 'verify_email',
          subjectId: subject.id,
          destination: subject.email!,
        }),
      );
    const a = await mint();
    const b = await mint();
    const consume = (token: string, purpose: 'verify_email' | 'password_reset') =>
      db.transaction((tx) => challenges.consumeLink(tx, { realm: 'user', purpose, token }));
    expect(await consume(a.token, 'password_reset')).toBeNull();
    expect(await consume(a.token, 'verify_email')).not.toBeNull();
    expect(await consume(b.token, 'verify_email')).toBeNull();
  });
});

describe('TOTP secrets and replay (FR-AUTH-005)', () => {
  it('encrypts the secret at rest and accepts a time step only once under concurrency', async () => {
    const mfa = app.get(MfaService, { strict: false });
    const subject = await newUser();
    const { secret } = await db.transaction((tx) =>
      mfa.enroll(tx, 'user', subject.id, subject.email!),
    );
    const { rows } = await db.transaction((tx) =>
      tx.execute<{ secret_ciphertext: Buffer }>(
        sql`select secret_ciphertext from mfa_factors where subject_id = ${subject.id}`,
      ),
    );
    expect(rows[0]?.secret_ciphertext.includes(Buffer.from(secret))).toBe(false);

    await db.transaction((tx) => mfa.confirm(tx, 'user', subject.id, code(secret, 0)));
    const next = code(secret, 1);
    const attempts = await Promise.all(
      [1, 2, 3].map(() => db.transaction((tx) => mfa.verifyTotp(tx, 'user', subject.id, next))),
    );
    expect(attempts.filter(Boolean)).toHaveLength(1);
  });
});

describe('nightly cleanup', () => {
  it('marks expired sessions and deletes long-ended sessions and old challenges', async () => {
    const subject = await newUser();
    const created = await db.transaction((tx) =>
      sessions.create(tx, { subject, authMethod: 'password', mfaVerified: false }),
    );
    await db.transaction((tx) =>
      tx.execute(
        sql`update sessions set idle_expires_at = now() - interval '40 days',
              absolute_expires_at = now() - interval '35 days' where id = ${created.row.id}`,
      ),
    );
    await db.transaction((tx) =>
      challenges.createLink(tx, {
        realm: 'user',
        purpose: 'password_reset',
        subjectId: subject.id,
        destination: subject.email!,
      }),
    );
    await db.transaction((tx) =>
      tx.execute(
        sql`update auth_challenges set expires_at = now() - interval '8 days' where subject_id = ${subject.id}`,
      ),
    );
    const sessionResult = await app.get(SessionCleanupTask, { strict: false }).run();
    expect(sessionResult.deleted).toBeGreaterThanOrEqual(1);
    const challengeResult = await app.get(ChallengeCleanupTask, { strict: false }).run();
    expect(challengeResult.deleted).toBeGreaterThanOrEqual(1);
  });
});

const code = (secret: string, stepOffset: number) =>
  generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 * stepOffset });
