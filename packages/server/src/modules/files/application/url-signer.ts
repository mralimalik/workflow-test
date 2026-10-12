import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

const claimsSchema = z.object({
  f: z.uuid(),
  o: z.uuid().nullable(),
  op: z.enum(['put', 'get']),
  exp: z.int(),
});
export type FileUrlClaims = z.infer<typeof claimsSchema>;

/**
 * Short-lived signed tokens for file URLs (HMAC-SHA256). The key is derived from
 * SESSION_SECRET with HKDF and a purpose label, so it is never used for anything else.
 */
export class FileUrlSigner {
  private readonly key: Buffer;

  constructor(secret: string) {
    this.key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), 'attendra/files/v1', 32));
  }

  sign(claims: FileUrlClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${payload}.${this.mac(payload)}`;
  }

  /** Returns the claims for a valid, unexpired token of the expected operation, else null. */
  verify(token: string, op: FileUrlClaims['op'], nowMs: number): FileUrlClaims | null {
    const [payload, mac] = token.split('.');
    if (!payload || !mac) return null;
    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(mac);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const parsed = claimsSchema.safeParse(
        JSON.parse(Buffer.from(payload, 'base64url').toString()),
      );
      if (!parsed.success || parsed.data.op !== op || parsed.data.exp * 1000 < nowMs) return null;
      return parsed.data;
    } catch {
      return null;
    }
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }
}
