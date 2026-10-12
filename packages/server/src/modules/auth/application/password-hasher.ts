import { hash, parseOptions, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/**
 * Argon2id with the OWASP baseline parameters (19 MiB, 2 passes, 1 lane) — the
 * `@node-rs/argon2` defaults, pinned here so a library change cannot weaken them silently.
 */
const PARAMS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;
/** `Algorithm.Argon2id` (a `const enum`, not readable at runtime under isolatedModules). */
const ARGON2ID = 2;

@Injectable()
export class PasswordHasher {
  /** A real hash of a random value, verified against when the account does not exist. */
  private dummy: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, PARAMS);
  }

  async verify(passwordHash: string | null, password: string): Promise<boolean> {
    if (!passwordHash) {
      // Same cost as a real check, so response time does not reveal unknown accounts.
      await verify(await this.dummyHash(), password).catch(() => false);
      return false;
    }
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /** True when the stored hash uses weaker or different parameters than the current policy. */
  needsRehash(passwordHash: string): boolean {
    try {
      const o = parseOptions(passwordHash);
      return (
        // `Algorithm` is a const enum we cannot import at runtime; 2 is Argon2id.
        // eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
        o.algorithm !== ARGON2ID ||
        o.memoryCost < PARAMS.memoryCost ||
        o.timeCost < PARAMS.timeCost ||
        o.outputLen !== PARAMS.outputLen
      );
    } catch {
      return true;
    }
  }

  private dummyHash(): Promise<string> {
    this.dummy ??= hash(`dummy-${Math.random()}`, PARAMS);
    return this.dummy;
  }
}
