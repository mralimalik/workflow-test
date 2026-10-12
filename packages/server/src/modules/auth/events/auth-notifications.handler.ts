import { Injectable, Logger } from '@nestjs/common';
import {
  loginSucceeded,
  passwordResetRequested,
  userEmailVerificationRequested,
  userSignedUp,
  type EventEnvelope,
} from '@attendra/contracts';

import { AppConfig } from '../../../kernel/config/app-config';
import { Database } from '../../../kernel/db/database';
import { FeatureFlags } from '../../feature-flags/feature-flags.public';
import { NotificationDispatcher } from '../../notifications/notifications.public';
import { HandlesEvents, type DomainEventHandler } from '../../outbox/outbox.public';
import { UsersService, type UserRow } from '../../users/users.public';
import { ChallengeService } from '../application/challenge.service';

export const LOGIN_ALERT_FLAG = 'auth.login_alert_email';

/**
 * Sends the auth emails (worker). Links are minted here, not in the request, so tokens
 * never sit in the outbox. Idempotent: the notification dedupe key is the event id, and a
 * retried job that mints a second link never invalidates the first (see ChallengeService).
 */
@HandlesEvents({
  consumer: 'auth-notifications',
  events: [
    userSignedUp.type,
    userEmailVerificationRequested.type,
    passwordResetRequested.type,
    loginSucceeded.type,
  ],
})
@Injectable()
export class AuthNotificationsHandler implements DomainEventHandler {
  private readonly logger = new Logger(AuthNotificationsHandler.name);
  private readonly dashboardUrl: string;

  constructor(
    config: AppConfig,
    private readonly db: Database,
    private readonly users: UsersService,
    private readonly challenges: ChallengeService,
    private readonly dispatcher: NotificationDispatcher,
    private readonly flags: FeatureFlags,
  ) {
    this.dashboardUrl = config.get('DASHBOARD_URL', { infer: true }).replace(/\/$/, '');
  }

  async handle(event: EventEnvelope): Promise<void> {
    switch (event.type) {
      case userSignedUp.type:
      case userEmailVerificationRequested.type: {
        const { userId } = userSignedUp.data.parse(event.data);
        await this.sendLink(event.id, userId, 'verify_email');
        return;
      }
      case passwordResetRequested.type: {
        const data = passwordResetRequested.data.parse(event.data);
        if (data.realm === 'user') await this.sendLink(event.id, data.subjectId, 'password_reset');
        return;
      }
      case loginSucceeded.type: {
        const data = loginSucceeded.data.parse(event.data);
        if (data.realm === 'user' && data.newDevice) {
          await this.sendLoginAlert(event, data.subjectId, data.deviceLabel);
        }
        return;
      }
      default:
        this.logger.warn({ eventType: event.type }, 'Unexpected event');
    }
  }

  private async sendLink(
    eventId: string,
    userId: string,
    purpose: 'verify_email' | 'password_reset',
  ): Promise<void> {
    const minted = await this.db.transaction(async (tx) => {
      const user = await this.users.findById(tx, userId);
      if (user?.status !== 'active') return null;
      if (purpose === 'verify_email' && user.emailVerifiedAt) return null;
      const { token } = await this.challenges.createLink(tx, {
        realm: 'user',
        purpose,
        subjectId: user.id,
        destination: user.email,
        context: { eventId },
      });
      return { user, token };
    });
    if (!minted) return;
    const path = purpose === 'verify_email' ? 'verify-email' : 'reset-password';
    await this.dispatcher.dispatch({
      organizationId: null,
      recipient: { type: 'user', id: minted.user.id, destination: minted.user.email },
      channel: 'email',
      eventKey: purpose === 'verify_email' ? 'auth.verify_email' : 'auth.password_reset',
      locale: minted.user.locale,
      category: 'security',
      values: {
        firstName: minted.user.firstName,
        link: `${this.dashboardUrl}/${path}?token=${minted.token}`,
      },
      related: { type: 'user', id: minted.user.id },
      dedupeKey: `${purpose}__${eventId}`,
    });
  }

  private async sendLoginAlert(
    event: EventEnvelope,
    userId: string,
    device: string | null,
  ): Promise<void> {
    if (!(await this.flags.isEnabled(LOGIN_ALERT_FLAG, { userId }))) return;
    const user = await this.db.transaction((tx) => this.users.findById(tx, userId));
    if (user?.status !== 'active') return;
    await this.dispatcher.dispatch({
      organizationId: null,
      recipient: { type: 'user', id: user.id, destination: user.email },
      channel: 'email',
      eventKey: 'auth.login_alert',
      locale: user.locale,
      category: 'security',
      values: {
        firstName: user.firstName,
        when: formatWhen(new Date(event.occurredAt), user),
        device: device ?? 'an unknown device',
        link: `${this.dashboardUrl}/forgot-password`,
      },
      related: { type: 'user', id: user.id },
      dedupeKey: `login_alert__${event.id}`,
    });
  }
}

function formatWhen(at: Date, user: UserRow): string {
  const timeZone = user.timezone ?? 'UTC';
  const text = new Intl.DateTimeFormat(user.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(at);
  return user.timezone ? text : `${text} UTC`;
}
