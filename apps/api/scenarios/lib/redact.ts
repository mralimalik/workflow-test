/**
 * Redaction for scenario reports: reports are shared for review, so secrets and one-time
 * codes never appear in them. Mirrors the logging redaction policy (BACKEND.md §8).
 */
const SENSITIVE_KEY =
  /^(.*password|.*secret|.*token|otp.*|totp.*|recoveryCodes?|.*apiKey|cookie|authorization|csrf.*)$/i;
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-csrf-token']);

export const REDACTED = '[redacted]';

/**
 * @param extraKeys exact keys to redact in addition, e.g. `code` in request bodies (a
 *   verification code) — not in responses, where `code` is the stable problem+json error code.
 */
export function redactValue(value: unknown, extraKeys: readonly string[] = []): unknown {
  if (Array.isArray(value)) return value.map((v) => redactValue(v, extraKeys));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        SENSITIVE_KEY.test(key) || extraKeys.includes(key) ? REDACTED : redactValue(v, extraKeys),
      ]),
    );
  }
  return value;
}

export function redactHeaders(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SENSITIVE_HEADERS.has(name.toLowerCase()) ? REDACTED : value,
    ]),
  );
}
