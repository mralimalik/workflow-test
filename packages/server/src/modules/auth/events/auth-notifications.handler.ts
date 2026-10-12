import { Injectable, Logger } from '@nestjs/common';
import {
  loginSucceeded,
  passwordResetRequested,
  platformAdminInvited,
  userEmailVerificationRequested,
  userSignedUp,
  type EventEnvelope,
} from '@attendra/contracts';

import { AppConfig } from '../../../kernel/config/app-config';
import { Database } from '../../../kernel/db/database';
import { FeatureFlags } from '../../feature-flags/feature-flags.public';
import { NotificationDispatcher } from '../../notifications/notifications.public';
import { HandlesEvents, type DomainEventHandler } from '../../outbox/outbox.public';
import { ChallengeService } from '../application/challenge.service';
import { Subjects, type PasswordAccount, type PasswordRealm } from '../application/subjects';

export const LOGIN_ALERT_FLAG = 'auth.login_alert_email';
const INVITATION_TTL_MS = 72 * 3_600_000;

type LinkKind = 'verify_email' | 'password_reset' | 'admin_invitation';

const LINKS: Record<
  LinkKind,
  { purpose: 'verify_email' | 'password_reset'; path: string; eventKey: string }
> = {
  verify_email: { purpose: 'verify_email', path: 'verify-email', eventKey: 'auth.verify_email' },
  password_reset: {
    purpose: 'password_reset',
    path: 'reset-password',
    eventKey: 'auth.password_reset',
  },
  admin_invitation: {
    purpose: 'password_reset',
    path: 'reset-password',
    eventKey: 'auth.admin_invitation',
  },
};

/**
 * Sends the auth emails (worker). Links are minted here, not in the request, so tokens
 * never sit in the outbox. Idempotent: the notification dedupe key is the event id, and a
 * retried job that mints a second link never invalidates the first (see ChallengeService).
 * Links point at the realm's app: the dashboard for users, the admin console for admins.
 */
@HandlesEvents({
  consumer: 'auth-notifications',
  events: [
    userSignedUp.type,
    userEmailVerificationRequested.type,
    passwordResetRequested.type,
    loginSucceeded.type,
    platformAdminInvited.type,
  ],
})
@Injectable()
export class AuthNotificationsHandler implements DomainEventHandler {
  private readonly logger = new Logger(AuthNotificationsHandler.name);
  private readonly appUrl: Record<PasswordRealm, string>;

  constructor(
    config: AppConfig,
    private readonly db: Database,
    private readonly subjects: Subjects,
    private readonly challenges: ChallengeService,
    private readonly dispatcher: NotificationDispatcher,
    private readonly flags: FeatureFlags,
  ) {
    const trim = (url: string) => url.replace(/\/$/, '');
    this.appUrl = {
      user: trim(config.get('DASHBOARD_URL', { infer: true })),
      platform_admin: trim(config.get('ADMIN_URL', { infer: true })),
    };
  }

  async handle(event: EventEnvelope): Promise<void> {
    switch (event.type) {
      case userSignedUp.type:
      case userEmailVerificationRequested.type: {
        const { userId } = userSignedUp.data.parse(event.data);
        await this.sendLink(event.id, 'user', userId, 'verify_email');
        return;
      }
      case passwordResetRequested.type: {
        const data = passwordResetRequested.data.parse(event.data);
        if (data.realm !== 'customer') {
          await this.sendLink(event.id, data.realm, data.subjectId, 'password_reset');
        }
        return;
      }
      case platformAdminInvited.type: {
        const { adminId } = platformAdminInvited.data.parse(event.data);
        await this.sendLink(event.id, 'platform_admin', adminId, 'admin_invitation');
        return;
      }
      case loginSucceeded.type: {
        const data = loginSucceeded.data.parse(event.data);
        if (data.realm !== 'customer' && data.newDevice) {
          await this.sendLoginAlert(event, data.realm, data.subjectId, data.deviceLabel);
        }
        return;
      }
      default:
        this.logger.warn({ eventType: event.type }, 'Unexpected event');
    }
  }

  private async sendLink(
    eventId: string,
    realm: PasswordRealm,
    subjectId: string,
    kind: LinkKind,
  ): Promise<void> {
    const link = LINKS[kind];
    const minted = await this.db.transaction(async (tx) => {
      const account = await this.subjects.findAccount(tx, realm, subjectId);
      if (account?.status !== 'active') return null;
      if (kind === 'verify_email' && (await this.subjects.isEmailVerified(tx, realm, account.id)))
        return null;
      const { token } = await this.challenges.createLink(tx, {
        realm,
        purpose: link.purpose,
        subjectId: account.id,
        destination: account.email,
        context: { eventId, kind },
        ...(kind === 'admin_invitation' ? { ttlMs: INVITATION_TTL_MS } : {}),
      });
      return { account, token };
    });
    if (!minted) return;
    await this.dispatcher.dispatch({
      organizationId: null,
      recipient: recipientOf(minted.account),
      channel: 'email',
      eventKey: link.eventKey,
      locale: minted.account.locale,
      category: 'security',
      values: {
        firstName: minted.account.greetingName,
        link: `${this.appUrl[realm]}/${link.path}?token=${minted.token}`,
      },
      related: { type: relatedType(realm), id: minted.account.id },
      dedupeKey: `${kind}__${eventId}`,
    });
  }

  private async sendLoginAlert(
    event: EventEnvelope,
    realm: PasswordRealm,
    subjectId: string,
    device: string | null,
  ): Promise<void> {
    if (realm === 'user' && !(await this.flags.isEnabled(LOGIN_ALERT_FLAG, { userId: subjectId })))
      return;
    const account = await this.db.transaction((tx) =>
      this.subjects.findAccount(tx, realm, subjectId),
    );
    if (account?.status !== 'active') return;
    await this.dispatcher.dispatch({
      organizationId: null,
      recipient: recipientOf(account),
      channel: 'email',
      eventKey: 'auth.login_alert',
      locale: account.locale,
      category: 'security',
      values: {
        firstName: account.greetingName,
        when: formatWhen(new Date(event.occurredAt), account),
        device: device ?? 'an unknown device',
        link: `${this.appUrl[realm]}/forgot-password`,
      },
      related: { type: relatedType(realm), id: account.id },
      dedupeKey: `login_alert__${event.id}`,
    });
  }
}

const relatedType = (realm: PasswordRealm) => (realm === 'user' ? 'user' : 'platform_admin');

function recipientOf(account: PasswordAccount) {
  // Notification recipients are customers, users or plain addresses; admins are addresses.
  return account.realm === 'user'
    ? { type: 'user' as const, id: account.id, destination: account.email }
    : { type: 'address' as const, destination: account.email };
}

function formatWhen(at: Date, account: PasswordAccount): string {
  const text = new Intl.DateTimeFormat(account.locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: account.timezone ?? 'UTC',
  }).format(at);
  return account.timezone ? text : `${text} UTC`;
}
