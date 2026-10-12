import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import { Database, type Tx } from '../../../kernel/db/database';
import { newId } from '../../../kernel/ids/ids';
import { type JobEnvelope, QUEUES } from '../../../kernel/queue/queues';
import { currentTraceContext } from '../../../kernel/queue/trace';
import { REDIS_CACHE, REDIS_KEY_PREFIX } from '../../../kernel/redis/redis.module';
import { renderTemplate, type TemplateValues } from '../domain/render';
import {
  notificationTemplates,
  type NotificationChannel,
} from '../infrastructure/notification-templates.schema';
import {
  notifications,
  type NotificationCategory,
} from '../infrastructure/notifications.partitioned';

const DEDUPE_TTL_S = 30 * 24 * 3600;

export interface NotificationRequest {
  organizationId: string | null;
  locationId?: string | null;
  recipient: { type: 'customer' | 'user' | 'address'; id?: string | null; destination: string };
  channel: NotificationChannel;
  eventKey: string;
  /** Preferred locale; falls back to `en` (organization defaults join in A6). */
  locale: string;
  category: NotificationCategory;
  values: TemplateValues;
  related?: { type: string; id: string };
  /** Same key twice → the second is dropped (e.g. `invitation__{id}__{resendCount}`). */
  dedupeKey?: string;
}

export interface SendNotificationJob extends JobEnvelope {
  notificationId: string;
  createdAt: string;
}

/**
 * Turns a notification request into a stored, rendered message and a send job
 * (features/notifications.md). Called from domain-event handlers in the worker — never
 * inline in a request (rule 1).
 */
@Injectable()
export class NotificationDispatcher {
  private readonly logger = new Logger(NotificationDispatcher.name);

  constructor(
    private readonly db: Database,
    @Inject(REDIS_CACHE) private readonly redis: Redis,
    @Inject(REDIS_KEY_PREFIX) private readonly prefix: string,
    @InjectQueue(QUEUES.notifications) private readonly queue: Queue<SendNotificationJob>,
  ) {}

  async dispatch(
    request: NotificationRequest,
  ): Promise<{ notificationId: string | null; duplicate: boolean }> {
    if (request.dedupeKey) {
      const first = await this.redis.set(
        `${this.prefix}:notification-dedupe:${request.dedupeKey}`,
        '1',
        'EX',
        DEDUPE_TTL_S,
        'NX',
      );
      if (first !== 'OK') {
        this.logger.log({ eventKey: request.eventKey }, 'Duplicate notification dropped');
        return { notificationId: null, duplicate: true };
      }
    }

    const id = newId();
    const createdAt = new Date();
    await this.inScope(request.organizationId, async (tx) => {
      const template = await this.resolveTemplate(tx, request);
      await tx.insert(notifications).values({
        id,
        createdAt,
        organizationId: request.organizationId,
        locationId: request.locationId ?? null,
        recipientType: request.recipient.type,
        recipientId: request.recipient.id ?? null,
        channel: request.channel,
        destination: request.recipient.destination,
        eventKey: request.eventKey,
        templateId: template.id,
        locale: template.locale,
        category: request.category,
        relatedType: request.related?.type ?? null,
        relatedId: request.related?.id ?? null,
        rendered: {
          subject: template.subject
            ? renderTemplate(template.subject, request.values, template.locale, 'text')
            : null,
          body: renderTemplate(template.body, request.values, template.locale, 'text'),
          html: template.htmlBody
            ? renderTemplate(template.htmlBody, request.values, template.locale, 'html')
            : null,
        },
        dedupeKey: request.dedupeKey ?? null,
      });
    });

    await this.queue.add(
      'send',
      {
        notificationId: id,
        createdAt: createdAt.toISOString(),
        organizationId: request.organizationId,
        ...currentTraceContext(),
      },
      { jobId: `notification__${id}` },
    );
    return { notificationId: id, duplicate: false };
  }

  /** Location override → organization override → platform default; requested locale, then `en`. */
  private async resolveTemplate(tx: Tx, request: NotificationRequest) {
    const locales = [
      ...new Set([request.locale, request.locale.split('-')[0] ?? request.locale, 'en']),
    ];
    const candidates = await tx
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.eventKey, request.eventKey),
          eq(notificationTemplates.channel, request.channel),
          eq(notificationTemplates.isActive, true),
          sql`${notificationTemplates.locale} in ${locales}`,
          request.organizationId
            ? or(
                isNull(notificationTemplates.organizationId),
                eq(notificationTemplates.organizationId, request.organizationId),
              )
            : isNull(notificationTemplates.organizationId),
        ),
      );
    const rank = (t: (typeof candidates)[number]) =>
      (request.locationId && t.locationId === request.locationId ? 0 : t.organizationId ? 1 : 2) *
        10 +
      locales.indexOf(t.locale);
    const best = candidates
      .filter((t) => !t.locationId || t.locationId === request.locationId)
      .sort((a, b) => rank(a) - rank(b))[0];
    if (!best)
      throw new Error(
        `No ${request.channel} template for ${request.eventKey} (${locales.join(', ')})`,
      );
    return best;
  }

  private inScope<T>(organizationId: string | null, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return organizationId
      ? this.db.tenantTx({ organizationId, actor: { type: 'system', id: 'notifications' } }, fn)
      : this.db.transaction(fn);
  }
}
