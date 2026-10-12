import { randomBytes } from 'node:crypto';

/** Crockford base32 without I, L, O, U: unambiguous when typed from paper. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const RECOVERY_CODE_COUNT = 10;

/** One code: 10 symbols (50 bits), shown as `XXXXX-XXXXX`. */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += ALPHABET.charAt(b & 31);
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
}

/** Canonical form for hashing: upper case, no separators, ambiguous letters mapped. */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}
