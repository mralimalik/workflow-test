import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { AppConfig } from '../../../kernel/config/app-config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** SMTP delivery via nodemailer (Mailpit locally; a transactional email service in production). */
@Injectable()
export class SmtpEmailProvider implements OnModuleDestroy {
  readonly name = 'smtp';
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(config: AppConfig) {
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASSWORD', { infer: true });
    this.transport = createTransport({
      host: config.get('SMTP_HOST', { infer: true }),
      port: config.get('SMTP_PORT', { infer: true }),
      secure: config.get('SMTP_PORT', { infer: true }) === 465,
      ...(user && pass ? { auth: { user, pass } } : {}),
    });
    this.from = config.get('EMAIL_FROM', { infer: true });
  }

  async send(message: EmailMessage): Promise<{ messageId: string }> {
    const info = (await this.transport.sendMail({ from: this.from, ...message })) as {
      messageId: string;
    };
    return { messageId: info.messageId };
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
