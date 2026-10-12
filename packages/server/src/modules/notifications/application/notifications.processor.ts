import { Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import { Database } from '../../../kernel/db/database';
import { AppProcessor } from '../../../kernel/queue/app-processor';
import { QUEUES } from '../../../kernel/queue/queues';
import { SmtpEmailProvider } from '../infrastructure/email-provider';
import { notifications } from '../infrastructure/notifications.partitioned';
import type { SendNotificationJob } from './notification-dispatcher';

const scope = {
  actor: { type: 'system', id: 'notifications' } as const,
  reason: 'deliver notification',
};

/** `notifications/send`: delivers one stored message and records the outcome. */
@Processor(QUEUES.notifications, { concurrency: 10 })
export class NotificationsProcessor extends AppProcessor<SendNotificationJob> {
  constructor(
    private readonly db: Database,
    private readonly email: SmtpEmailProvider,
  ) {
    super();
  }

  protected async handle(job: Job<SendNotificationJob>): Promise<string> {
    const key = and(
      eq(notifications.id, job.data.notificationId),
      eq(notifications.createdAt, new Date(job.data.createdAt)),
    );
    const [row] = await this.db.platformTx(scope, (tx) =>
      tx.select().from(notifications).where(key),
    );
    if (!row) throw new Error('Notification not found');
    if (row.status === 'sent' || row.status === 'delivered') return row.status; // idempotent

    await this.db.platformTx(scope, (tx) =>
      tx.update(notifications).set({ status: 'sending' }).where(key),
    );
    try {
      if (row.channel !== 'email') throw new Error(`Channel ${row.channel} is not available yet`);
      const { messageId } = await this.email.send({
        to: row.destination,
        subject: row.rendered.subject ?? '',
        text: row.rendered.body,
        ...(row.rendered.html ? { html: row.rendered.html } : {}),
      });
      await this.db.platformTx(scope, (tx) =>
        tx
          .update(notifications)
          .set({
            status: 'sent',
            provider: this.email.name,
            providerMessageId: messageId,
            sentAt: new Date(),
            errorMessage: null,
          })
          .where(key),
      );
      return 'sent';
    } catch (error) {
      const final = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await this.db.platformTx(scope, (tx) =>
        tx
          .update(notifications)
          .set({
            status: final ? 'failed' : 'queued',
            errorMessage: error instanceof Error ? error.message.slice(0, 1000) : 'unknown',
          })
          .where(key),
      );
      throw error;
    }
  }
}
