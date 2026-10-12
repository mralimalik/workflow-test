import { Injectable } from '@nestjs/common';

import { Database } from '../../../kernel/db/database';
import {
  MaintenanceTaskProvider,
  type MaintenanceTask,
} from '../../../kernel/maintenance/maintenance';
import { Clock } from '../../../kernel/time/clock';
import { ChallengesRepository } from '../infrastructure/challenges.repository';
import { SessionsRepository } from '../infrastructure/sessions.repository';

const DAY = 24 * 3_600_000;
/** Ended sessions stay listed for audits/support this long, then are deleted. */
const SESSION_RETENTION_MS = 30 * DAY;
const CHALLENGE_RETENTION_MS = 7 * DAY;

/** `session-cleanup` (nightly): marks expired sessions, deletes long-ended ones. */
@MaintenanceTaskProvider()
@Injectable()
export class SessionCleanupTask implements MaintenanceTask {
  readonly name = 'session-cleanup';
  readonly schedule = '15 3 * * *';

  constructor(
    private readonly db: Database,
    private readonly sessions: SessionsRepository,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<{ expired: number; deleted: number }> {
    const now = this.clock.now();
    return this.db.transaction(async (tx) => ({
      expired: await this.sessions.markExpired(tx, now),
      deleted: await this.sessions.deleteEndedBefore(
        tx,
        new Date(now.getTime() - SESSION_RETENTION_MS),
      ),
    }));
  }
}

/** `challenge-cleanup` (nightly): deletes one-time secrets a week after they expired. */
@MaintenanceTaskProvider()
@Injectable()
export class ChallengeCleanupTask implements MaintenanceTask {
  readonly name = 'challenge-cleanup';
  readonly schedule = '20 3 * * *';

  constructor(
    private readonly db: Database,
    private readonly challenges: ChallengesRepository,
    private readonly clock: Clock,
  ) {}

  async run(): Promise<{ deleted: number }> {
    const before = new Date(this.clock.now().getTime() - CHALLENGE_RETENTION_MS);
    return {
      deleted: await this.db.transaction((tx) => this.challenges.deleteExpiredBefore(tx, before)),
    };
  }
}
