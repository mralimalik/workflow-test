import type { Realm } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import { AppConfig } from '../../../kernel/config/app-config';
import { RequestContext } from '../../../kernel/context/request-context';
import { Pepper, randomToken } from '../../../kernel/crypto/secrets';
import type { Tx } from '../../../kernel/db/database';
import { newId } from '../../../kernel/ids/ids';
import { Clock } from '../../../kernel/time/clock';
import type { ChallengePurpose, ChallengeRow } from '../infrastructure/auth.schema';
import { ChallengesRepository } from '../infrastructure/challenges.repository';

/** Link lifetimes (match the wording of the platform email templates). */
export const LINK_TTL_MS: Partial<Record<ChallengePurpose, number>> = {
  verify_email: 24 * 3_600_000,
  password_reset: 30 * 60_000,
};

/**
 * One-time secrets in `auth_challenges` (FR-AUTH-003, FR-AUTH-010). Only a peppered HMAC
 * is stored; links are single-use and consuming one closes the subject's other open links
 * for the same purpose. Several links may be open at once, so a retried email job that
 * mints a second link never invalidates the one already delivered.
 */
@Injectable()
export class ChallengeService {
  private readonly pepper: Pepper;

  constructor(
    config: AppConfig,
    private readonly repository: ChallengesRepository,
    private readonly clock: Clock,
  ) {
    this.pepper = new Pepper(config.get('SESSION_SECRET', { infer: true }), 'auth-challenge');
  }

  async createLink(
    tx: Tx,
    input: {
      realm: Realm;
      purpose: ChallengePurpose;
      subjectId: string;
      destination: string;
      context?: Record<string, unknown>;
    },
  ): Promise<{ token: string; challenge: ChallengeRow }> {
    const ttl = LINK_TTL_MS[input.purpose];
    if (!ttl) throw new Error(`No link lifetime for ${input.purpose}`);
    const token = randomToken();
    const challenge = await this.repository.insert(tx, {
      id: newId(),
      kind: 'link',
      purpose: input.purpose,
      realm: input.realm,
      subjectId: input.subjectId,
      channel: 'email',
      destination: input.destination,
      secretHash: this.pepper.hash(token),
      maxAttempts: 1,
      expiresAt: new Date(this.clock.now().getTime() + ttl),
      ip: RequestContext.get()?.ip ?? null,
      context: input.context ?? {},
    });
    return { token, challenge };
  }

  /** Consumes a link token; null when unknown, used, expired or for another purpose. */
  async consumeLink(
    tx: Tx,
    input: { realm: Realm; purpose: ChallengePurpose; token: string },
  ): Promise<ChallengeRow | null> {
    const now = this.clock.now();
    const challenge = await this.repository.consumeLink(tx, {
      realm: input.realm,
      purpose: input.purpose,
      secretHash: this.pepper.hash(input.token),
      now,
    });
    if (challenge?.subjectId) {
      await this.repository.closeOthers(tx, {
        realm: input.realm,
        subjectId: challenge.subjectId,
        purpose: input.purpose,
        exceptId: challenge.id,
        now,
      });
    }
    return challenge;
  }
}
