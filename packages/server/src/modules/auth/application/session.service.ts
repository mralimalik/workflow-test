import type { Realm } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../../kernel/context/request-context';
import { randomToken, sha256 } from '../../../kernel/crypto/secrets';
import { Database, type Tx } from '../../../kernel/db/database';
import { UnauthenticatedError } from '../../../kernel/errors/app-error';
import { newId } from '../../../kernel/ids/ids';
import { Clock } from '../../../kernel/time/clock';
import { OutboxWriter } from '../../outbox/outbox.public';
import { deviceLabel } from '../domain/device-label';
import { initialExpiry, needsTouch, sessionState, slidIdleExpiry } from '../domain/realm-policy';
import type { RevokeReason, SessionRow } from '../infrastructure/auth.schema';
import { SessionCache, type CachedSession } from '../infrastructure/session-cache';
import { SessionsRepository } from '../infrastructure/sessions.repository';
import { sessionRevoked } from '@attendra/contracts';
import { MfaRepository } from '../infrastructure/mfa.repository';
import { Subjects, type AuthSubject } from './subjects';

/** An authenticated session as seen by guards and handlers. */
export interface ActiveSession extends CachedSession {
  /** Hex SHA-256 of the session token (cache key). */
  readonly tokenHash: string;
}

export interface NewSessionInput {
  subject: AuthSubject;
  authMethod: SessionRow['authMethod'];
  mfaVerified: boolean;
}

export interface CreatedSession {
  /** The raw token for the cookie; never stored. */
  token: string;
  session: ActiveSession;
  row: SessionRow;
}

/**
 * Sessions (BACKEND.md §6, data model 01): opaque 256-bit tokens, stored hashed, with a
 * Redis hot copy. Revocation is immediate: the row is revoked and the cache entry evicted
 * in the same step, so the very next request is refused.
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly db: Database,
    private readonly repository: SessionsRepository,
    private readonly cache: SessionCache,
    private readonly subjects: Subjects,
    private readonly mfa: MfaRepository,
    private readonly outbox: OutboxWriter,
    private readonly clock: Clock,
  ) {}

  async create(tx: Tx, input: NewSessionInput): Promise<CreatedSession> {
    const now = this.clock.now();
    const token = randomToken();
    const tokenHash = sha256(token);
    const csrfSecret = sha256(randomToken());
    const ctx = RequestContext.get();
    const row = await this.repository.insert(tx, {
      id: newId(),
      tokenHash,
      subjectType: input.subject.realm,
      subjectId: input.subject.id,
      clientType: 'web',
      authMethod: input.authMethod,
      mfaVerifiedAt: input.mfaVerified ? now : null,
      csrfSecret,
      subjectVersion: input.subject.sessionVersion,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent?.slice(0, 512) ?? null,
      deviceLabel: deviceLabel(ctx?.userAgent),
      lastSeenAt: now,
      createdAt: now,
      ...initialExpiry(input.subject.realm, now),
    });
    const mfaPending = await this.mfaPending(tx, input.subject);
    return { token, row, session: this.toActive(row, mfaPending, input.subject.role) };
  }

  /**
   * Resolves a cookie token to an active session, or throws `401`. Cache first; on a miss
   * the row and its subject are checked in Postgres. Activity slides the idle expiry (at
   * most once a minute).
   */
  async resolve(realm: Realm, token: string): Promise<ActiveSession> {
    if (token.length < 32 || token.length > 128) throw new UnauthenticatedError();
    const tokenHash = sha256(token).toString('hex');
    const now = this.clock.now();

    let session: ActiveSession | null = null;
    const cached = await this.cache.get(tokenHash);
    if (cached) session = { ...cached, tokenHash };
    session ??= await this.load(realm, tokenHash);
    if (session?.realm !== realm) throw new UnauthenticatedError();
    const { id, subjectId } = session;

    const state = sessionState(
      {
        idleExpiresAt: new Date(session.idleExpiresAt),
        absoluteExpiresAt: new Date(session.absoluteExpiresAt),
      },
      now,
    );
    if (state !== 'active') {
      await this.db.transaction((tx) =>
        this.revokeInTx(tx, { realm, subjectId, sessionId: id }, 'expired'),
      );
      throw new UnauthenticatedError('session_expired');
    }

    if (needsTouch(new Date(session.lastSeenAt), now)) {
      const idleExpiresAt = slidIdleExpiry(realm, now, new Date(session.absoluteExpiresAt));
      const live = await this.db.transaction((tx) =>
        this.repository.touch(tx, id, now, idleExpiresAt),
      );
      if (!live) {
        await this.cache.evict([tokenHash]);
        throw new UnauthenticatedError('session_expired');
      }
      session = {
        ...session,
        lastSeenAt: now.toISOString(),
        idleExpiresAt: idleExpiresAt.toISOString(),
      };
      await this.writeCache(session, now);
    }
    return session;
  }

  async list(realm: Realm, subjectId: string): Promise<SessionRow[]> {
    return this.db.transaction((tx) =>
      this.repository.listActive(tx, realm, subjectId, this.clock.now()),
    );
  }

  /**
   * Revokes sessions inside the caller's transaction and evicts them from the cache before
   * returning. Eviction before commit is safe: a tombstone only prevents caching, and the
   * committed row is what every later load sees.
   */
  async revokeInTx(
    tx: Tx,
    filter: { realm: Realm; subjectId: string; sessionId?: string; exceptSessionId?: string },
    reason: RevokeReason,
  ): Promise<string[]> {
    const revoked = await this.repository.revoke(tx, filter, reason, this.clock.now());
    if (revoked.length === 0) return [];
    await this.cache.evict(revoked.map((r) => r.tokenHash.toString('hex')));
    await this.outbox.write(tx, sessionRevoked, {
      aggregateId: filter.subjectId,
      organizationId: null,
      data: {
        realm: filter.realm,
        subjectId: filter.subjectId,
        sessionIds: revoked.map((r) => r.id),
        reason,
      },
    });
    return revoked.map((r) => r.id);
  }

  async markMfaVerified(tx: Tx, session: ActiveSession): Promise<void> {
    await this.repository.markMfaVerified(tx, session.id, this.clock.now());
    await this.cache.refresh([session.tokenHash]);
  }

  /** Drops cached copies of the subject's sessions so they reload (e.g. MFA state changed). */
  async refreshSubject(tx: Tx, realm: Realm, subjectId: string): Promise<void> {
    const hashes = await this.repository.activeTokenHashes(tx, realm, subjectId);
    await this.cache.refresh(hashes.map((h) => h.toString('hex')));
  }

  /** True when no earlier session of the subject used this device. */
  async isNewDevice(tx: Tx, row: SessionRow): Promise<boolean> {
    if (!row.deviceLabel) return false;
    return !(await this.repository.seenDevice(
      tx,
      row.subjectType,
      row.subjectId,
      row.deviceLabel,
      row.id,
    ));
  }

  private async load(realm: Realm, tokenHash: string): Promise<ActiveSession | null> {
    const now = this.clock.now();
    const session = await this.db.transaction(async (tx) => {
      const row = await this.repository.findActiveByTokenHash(tx, Buffer.from(tokenHash, 'hex'));
      if (row?.subjectType !== realm) return null;
      const subject = await this.subjects.find(tx, realm, row.subjectId);
      if (subject?.status !== 'active' || subject.sessionVersion !== row.subjectVersion) {
        await this.revokeInTx(
          tx,
          { realm, subjectId: row.subjectId, sessionId: row.id },
          subject?.status === 'banned' ? 'banned' : 'admin',
        );
        return null;
      }
      return this.toActive(row, await this.mfaPending(tx, subject), subject.role);
    });
    if (session) await this.writeCache(session, now);
    return session;
  }

  private async writeCache(session: ActiveSession, now: Date): Promise<void> {
    const { tokenHash, ...entry } = session;
    const until = Math.min(
      new Date(session.idleExpiresAt).getTime(),
      new Date(session.absoluteExpiresAt).getTime(),
    );
    await this.cache.put(tokenHash, entry, until - now.getTime());
  }

  private async mfaPending(tx: Tx, subject: AuthSubject): Promise<boolean> {
    if (!subject.mfaRequired || subject.realm === 'customer') return false;
    const totp = await this.mfa.findActive(tx, subject.realm, subject.id, 'totp');
    return totp === null;
  }

  private toActive(row: SessionRow, mfaPending: boolean, role: string | null): ActiveSession {
    return {
      id: row.id,
      tokenHash: row.tokenHash.toString('hex'),
      realm: row.subjectType,
      subjectId: row.subjectId,
      subjectVersion: row.subjectVersion,
      role,
      csrfToken: (row.csrfSecret ?? Buffer.alloc(0)).toString('base64url'),
      authMethod: row.authMethod,
      mfaVerifiedAt: row.mfaVerifiedAt?.toISOString() ?? null,
      mfaPending,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      idleExpiresAt: row.idleExpiresAt.toISOString(),
      absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    };
  }
}
