import Bowser from 'bowser';

/** "Chrome on macOS" — for session lists and new-device alerts. Null when unknown. */
export function deviceLabel(userAgent: string | undefined | null): string | null {
  if (!userAgent) return null;
  const parsed = Bowser.parse(userAgent);
  const browser = parsed.browser.name;
  const os = parsed.os.name;
  if (!browser && !os) return null;
  if (!os) return browser ?? null;
  if (!browser) return os;
  return `${browser} on ${os}`;
}
