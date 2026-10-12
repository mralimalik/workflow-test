import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { AppConfig } from '../../../kernel/config/app-config';
import { COMMON_PASSWORDS } from '../domain/common-passwords';

const HIBP_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const HIBP_TIMEOUT_MS = 2_000;

/**
 * Breached-password check (features/auth-and-identity.md rule 2): a local list of the most
 * common passwords, plus — when `PASSWORD_BREACH_CHECK=hibp` — the Have I Been Pwned
 * range API with k-anonymity (only the first 5 hex chars of the SHA-1 leave the server;
 * responses are padded). HIBP failures fail open with a warning: an outage must not block
 * signups, and the local list still applies.
 */
@Injectable()
export class BreachedPasswordChecker {
  private readonly logger = new Logger(BreachedPasswordChecker.name);
  private readonly useHibp: boolean;

  constructor(config: AppConfig) {
    this.useHibp = config.get('PASSWORD_BREACH_CHECK', { infer: true }) === 'hibp';
  }

  async isBreached(password: string): Promise<boolean> {
    if (COMMON_PASSWORDS.has(password.toLowerCase())) return true;
    if (!this.useHibp) return false;
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    try {
      const res = await fetch(`${HIBP_RANGE_URL}${prefix}`, {
        headers: { 'Add-Padding': 'true', 'User-Agent': 'Attendra' },
        signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HIBP responded ${res.status}`);
      const body = await res.text();
      return body.split('\n').some((line) => {
        const [hashSuffix, count] = line.trim().split(':');
        return hashSuffix === suffix && Number(count) > 0;
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Breached-password service unavailable; local list only');
      return false;
    }
  }
}
