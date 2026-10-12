import { Global, Module } from '@nestjs/common';

import { NotificationDispatcher } from './application/notification-dispatcher';
import { NotificationsProcessor } from './application/notifications.processor';
import { SmtpEmailProvider } from './infrastructure/email-provider';

/** Dispatch (any process; used by event handlers). */
@Global()
@Module({ providers: [NotificationDispatcher], exports: [NotificationDispatcher] })
export class NotificationsModule {}

/** Delivery (worker only). */
@Module({ providers: [SmtpEmailProvider, NotificationsProcessor] })
export class NotificationsWorkerModule {}
