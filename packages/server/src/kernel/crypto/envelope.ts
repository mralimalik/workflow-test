import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption (BACKEND.md §12): a random per-record data key encrypts the secret
 * with AES-256-GCM; the data key is wrapped by the master key and stored alongside with the
 * master key id, so rotation re-wraps data keys without touching secrets. `aad` binds a
 * ciphertext to its record (e.g. `mfa_factors:<id>`), so it cannot be swapped into another.
 *
 * Layout (version 1):
 * `0x01 | keyIdLen(1) | keyId | wrapIv(12) | wrapTag(16) | wrappedKey(32) | iv(12) | tag(16) | ciphertext`
 */
const VERSION = 1;
const IV = 12;
const TAG = 16;
const KEY = 32;

export interface MasterKey {
  readonly id: string;
  readonly key: Buffer;
}

export class EnvelopeCipher {
  private readonly keys: ReadonlyMap<string, Buffer>;

  /** @param current the key new records are wrapped with; @param previous keys still readable. */
  constructor(
    private readonly current: MasterKey,
    previous: readonly MasterKey[] = [],
  ) {
    for (const k of [current, ...previous]) {
      if (k.key.length !== KEY) throw new Error(`Master key ${k.id} must be 32 bytes`);
      if (Buffer.byteLength(k.id) > 255) throw new Error('Master key id too long');
    }
    this.keys = new Map([current, ...previous].map((k) => [k.id, k.key]));
  }

  encrypt(plaintext: Buffer | string, aad: string): Buffer {
    const dataKey = randomBytes(KEY);
    const [wrapIv, wrapTag, wrapped] = seal(this.current.key, dataKey, `dek:${aad}`);
    const [iv, tag, ciphertext] = seal(dataKey, Buffer.from(plaintext), aad);
    const keyId = Buffer.from(this.current.id);
    return Buffer.concat([
      Buffer.from([VERSION, keyId.length]),
      keyId,
      wrapIv,
      wrapTag,
      wrapped,
      iv,
      tag,
      ciphertext,
    ]);
  }

  decrypt(envelope: Buffer, aad: string): Buffer {
    if (envelope[0] !== VERSION) throw new Error('Unsupported envelope version');
    const idLen = envelope[1] ?? 0;
    let o = 2;
    const take = (n: number) => envelope.subarray(o, (o += n));
    const keyId = take(idLen).toString();
    const master = this.keys.get(keyId);
    if (!master) throw new Error(`Unknown master key id ${keyId}`);
    const dataKey = open(master, take(IV), take(TAG), take(KEY), `dek:${aad}`);
    const iv = take(IV);
    const tag = take(TAG);
    return open(dataKey, iv, tag, envelope.subarray(o), aad);
  }

  /** The master key id an envelope was wrapped with (rotation jobs re-wrap old ones). */
  static keyIdOf(envelope: Buffer): string {
    return envelope.subarray(2, 2 + (envelope[1] ?? 0)).toString();
  }
}

function seal(key: Buffer, plaintext: Buffer, aad: string): [Buffer, Buffer, Buffer] {
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext];
}

function open(key: Buffer, iv: Buffer, tag: Buffer, ciphertext: Buffer, aad: string): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
