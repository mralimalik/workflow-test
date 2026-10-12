import { setTimeout as sleep } from 'node:timers/promises';

/** Mailpit HTTP API (local dev inbox, CI service) — used by tests to read sent emails. */
const base =
  process.env['MAILPIT_API_URL'] ?? `http://${process.env['SMTP_HOST'] ?? 'localhost'}:8025`;

export interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function waitForEmail(
  to: string,
  timeoutMs = 10_000,
  options: { subject?: string } = {},
): Promise<{ summary: MailpitMessage; text: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  const query = `to:"${to}"${options.subject ? ` subject:"${options.subject}"` : ''}`;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/v1/search?query=${encodeURIComponent(query)}`);
    const body = (await res.json()) as { messages: MailpitMessage[] };
    const summary = body.messages[0];
    if (summary) {
      const full = (await (await fetch(`${base}/api/v1/message/${summary.ID}`)).json()) as {
        Text: string;
        HTML: string;
      };
      return { summary, text: full.Text, html: full.HTML };
    }
    await sleep(200);
  }
  throw new Error(`No email to ${to} within ${timeoutMs} ms`);
}
