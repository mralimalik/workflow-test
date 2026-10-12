import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** A random opaque token (session ids, link tokens): 256 bits, base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 of a high-entropy token — how session ids are stored (data model 01 `sessions`). */
export function sha256(value: string | Buffer): Buffer {
  return createHash('sha256').update(value).digest();
}

/** Constant-time comparison of two strings or buffers of any length. */
export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const x = sha256(a);
  const y = sha256(b);
  return timingSafeEqual(x, y);
}

/**
 * Keyed hashing with a purpose-specific key derived (HKDF-SHA-256) from `SESSION_SECRET`,
 * the "server pepper" for one-time secrets (data model 01 `auth_challenges.secret_hash`):
 * a leaked table alone does not let anyone test guesses of 6-digit codes.
 */
export class Pepper {
  private readonly key: Buffer;

  constructor(secret: string, purpose: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, 'attendra-pepper', purpose, 32));
  }

  hash(value: string): Buffer {
    return createHmac('sha256', this.key).update(value).digest();
  }
}
