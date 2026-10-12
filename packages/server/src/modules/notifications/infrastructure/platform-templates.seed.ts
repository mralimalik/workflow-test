import type { Pool } from 'pg';

import type { Seed } from '../../../kernel/db/seeds/seed';
import { newId } from '../../../kernel/ids/ids';

const layout = (inner: string) =>
  `<!doctype html><html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827"><div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">${inner}<p style="margin-top:32px;font-size:12px;color:#6b7280">Attendra</p></div></body></html>`;
const button = (label: string) =>
  `<p style="margin:24px 0"><a href="{link}" style="background:#111827;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${label}</a></p><p style="font-size:12px;color:#6b7280">Or paste this link into your browser: {link}</p>`;

/**
 * Platform default email templates (security wording; not overridable for `auth.*`).
 * ICU MessageFormat; use ’ (not ') for apostrophes, since ' is ICU's escape character.
 */
export const PLATFORM_TEMPLATES = [
  {
    eventKey: 'auth.verify_email',
    subject: 'Confirm your email address',
    body: 'Hi {firstName},\n\nConfirm your email address to finish setting up your Attendra account:\n{link}\n\nThis link expires in 24 hours. If you didn’t create an account, you can ignore this email.',
    htmlBody: layout(
      `<h1 style="font-size:20px">Confirm your email</h1><p>Hi {firstName}, confirm your email address to finish setting up your Attendra account.</p>${button('Confirm email')}<p style="font-size:12px;color:#6b7280">This link expires in 24 hours. If you didn’t create an account, you can ignore this email.</p>`,
    ),
  },
  {
    eventKey: 'auth.password_reset',
    subject: 'Reset your password',
    body: 'Hi {firstName},\n\nWe received a request to reset your Attendra password. Use this link within 30 minutes:\n{link}\n\nIf you didn’t ask for this, ignore this email; your password stays the same.',
    htmlBody: layout(
      `<h1 style="font-size:20px">Reset your password</h1><p>Hi {firstName}, we received a request to reset your Attendra password. The link works once, for 30 minutes.</p>${button('Choose a new password')}<p style="font-size:12px;color:#6b7280">If you didn’t ask for this, ignore this email; your password stays the same.</p>`,
    ),
  },
  {
    eventKey: 'auth.login_alert',
    subject: 'New sign-in to your Attendra account',
    body: 'Hi {firstName},\n\nYour account was used to sign in on {when} from {device}.\n\nIf this was you, there is nothing to do. If not, reset your password now:\n{link}',
    htmlBody: layout(
      `<h1 style="font-size:20px">New sign-in</h1><p>Hi {firstName}, your account was used to sign in on <b>{when}</b> from <b>{device}</b>.</p><p>If this wasn’t you, reset your password now.</p>${button('Reset password')}`,
    ),
  },
  {
    eventKey: 'auth.admin_invitation',
    subject: 'You have been added to the Attendra admin console',
    body: 'Hi {firstName},\n\nYou have been given access to the Attendra admin console. Set your password within 72 hours:\n{link}\n\nYou will set up two-factor authentication when you first sign in.',
    htmlBody: layout(
      `<h1 style="font-size:20px">Welcome to the admin console</h1><p>Hi {firstName}, you have been given access to the Attendra admin console. Set your password within 72 hours.</p>${button('Set your password')}<p style="font-size:12px;color:#6b7280">You will set up two-factor authentication when you first sign in.</p>`,
    ),
  },
  {
    eventKey: 'team.invitation',
    subject: '{inviterName} invited you to {organizationName} on Attendra',
    body: '{inviterName} invited you to join {organizationName} on Attendra.\n\nAccept the invitation:\n{link}\n\nThe invitation expires in 7 days.',
    htmlBody: layout(
      `<h1 style="font-size:20px">Join {organizationName}</h1><p>{inviterName} invited you to join <b>{organizationName}</b> on Attendra.</p>${button('Accept invitation')}<p style="font-size:12px;color:#6b7280">The invitation expires in 7 days.</p>`,
    ),
  },
] as const;

/** Upserts the platform default templates (idempotent: by event, channel and locale). */
export const platformTemplatesSeed: Seed = {
  name: 'notification-templates',
  environments: ['local', 'dev', 'staging', 'production'],
  async run(pool: Pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`select set_config('app.scope', 'platform', true)`);
      for (const t of PLATFORM_TEMPLATES) {
        await client.query(
          `insert into notification_templates (id, organization_id, location_id, event_key, channel, locale, subject, body, html_body)
           values ($1, null, null, $2, 'email', 'en', $3, $4, $5)
           on conflict on constraint notification_templates_scope_uq
           do update set subject = excluded.subject, body = excluded.body, html_body = excluded.html_body,
                         version = notification_templates.version + 1, updated_at = now()
           where (notification_templates.subject, notification_templates.body, notification_templates.html_body)
                 is distinct from (excluded.subject, excluded.body, excluded.html_body)`,
          [newId(), t.eventKey, t.subject, t.body, t.htmlBody],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
