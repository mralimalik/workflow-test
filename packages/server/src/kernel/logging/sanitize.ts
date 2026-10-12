/**
 * Log sanitization (BACKEND.md §8.1). Applied to every log object, at any depth:
 * - secret-bearing keys are replaced with `[redacted]`;
 * - emails and phone numbers are masked;
 * - message/transcript bodies are dropped.
 * Header redaction is additionally done by pino `redact` paths (see logger.module.ts).
 */
export const REDACTED = '[redacted]';

const SECRET_KEY =
  /^(.*password.*|.*secret.*|.*token.*|.*apikey|api[_-]?key|authorization|cookie|set-cookie|otp.*|totp.*|code|.*recoverycodes?|.*cvc|.*cvv|cardnumber|pan|csrf.*)$/i;
const BODY_KEY = /^(body|transcript|prompt|messages?|content|rawbody)$/i;
const EMAIL_KEY = /email/i;
const PHONE_KEY = /phone|msisdn|^from$|^to$/i;
const MAX_DEPTH = 8;

/** `jane.doe@example.com` → `j•••@example.com` */
export function maskEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at < 1) return REDACTED;
  return `${value.charAt(0)}•••${value.slice(at)}`;
}

/** `+14155554567` → `+1•••••4567` (keeps country prefix and last four digits). */
export function maskPhone(value: string): string {
  const digits = value.replace(/[^\d+]/g, '');
  if (digits.replace('+', '').length < 7) return REDACTED;
  const plus = digits.startsWith('+');
  const body = plus ? digits.slice(1) : digits;
  const prefix = plus ? `+${body.slice(0, 1)}` : '';
  return `${prefix}•••••${body.slice(-4)}`;
}

function sanitizeValue(key: string, value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (SECRET_KEY.test(key)) return REDACTED;
  if (BODY_KEY.test(key) && typeof value !== 'number' && typeof value !== 'boolean')
    return REDACTED;
  if (typeof value === 'string') {
    if (EMAIL_KEY.test(key)) return maskEmail(value);
    if (PHONE_KEY.test(key)) return maskPhone(value);
    return value;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return value; // pino's err serializer handles errors
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => sanitizeValue(key, v, depth + 1, seen));
  return sanitizeObject(value as Record<string, unknown>, depth + 1, seen);
}

function sanitizeObject(
  obj: Record<string, unknown>,
  depth: number,
  seen: WeakSet<object>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) out[key] = sanitizeValue(key, value, depth, seen);
  return out;
}

/** Returns a sanitized copy; the input is not modified. */
export function sanitizeLogObject(obj: Record<string, unknown>): Record<string, unknown> {
  return sanitizeObject(obj, 0, new WeakSet());
}
