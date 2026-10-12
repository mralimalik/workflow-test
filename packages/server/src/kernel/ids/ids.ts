import { randomInt } from 'node:crypto';

import { v7 as uuidv7, validate, version } from 'uuid';

/** New UUIDv7 primary key: time-ordered, generated in the app (data model §1). */
export function newId(): string {
  return uuidv7();
}

export function isUuidV7(value: string): boolean {
  return validate(value) && version(value) === 7;
}

/** Crockford base32: no I, L, O or U, so codes are unambiguous when read aloud or typed. */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const REFERENCE_LENGTH = 6;

/**
 * Human-facing reference code such as `BK-7F3K2Q` (32^6 ≈ 1.07 billion values).
 * Uniqueness is enforced by a database constraint; callers retry on conflict.
 */
export function newReferenceCode(prefix: string): string {
  if (!/^[A-Z]{2}$/.test(prefix))
    throw new Error(`Reference prefix must be two letters: ${prefix}`);
  let code = '';
  for (let i = 0; i < REFERENCE_LENGTH; i++) code += CROCKFORD_ALPHABET.charAt(randomInt(32));
  return `${prefix}-${code}`;
}

/** Normalizes user input (`bk-7f3k2q`, `BK 7F3K2Q`, `o`→`0`, `i`/`l`→`1`) to the canonical form. */
export function normalizeReferenceCode(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s-]/g, '');
  const match = /^(?<prefix>[A-Z]{2})(?<body>[0-9A-Z]{6})$/.exec(compact);
  const prefix = match?.groups?.['prefix'];
  const rawBody = match?.groups?.['body'];
  if (!prefix || !rawBody) return null;
  const body = rawBody.replace(/O/g, '0').replace(/[IL]/g, '1');
  // Crockford alphabet only (no U after normalization).
  if (!/^[0-9A-HJKMNP-TV-Z]{6}$/.test(body)) return null;
  return `${prefix}-${body}`;
}
