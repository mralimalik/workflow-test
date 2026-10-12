import { Injectable } from '@nestjs/common';

import { ValidationError } from '../../../kernel/errors/app-error';
import { passwordProblems, type PasswordProblem } from '../domain/password-policy';
import { BreachedPasswordChecker } from './breached-passwords';
import { PasswordHasher } from './password-hasher';

const MESSAGES: Record<PasswordProblem, string> = {
  too_short: 'Use at least 10 characters',
  too_long: 'Use at most 256 characters',
  contains_email: 'Do not use your email address in your password',
  breached:
    'This password has appeared in a data breach. Choose a different one (a short phrase works well).',
};

/** Checks a new password against the policy and hashes it (features/auth-and-identity.md rule 2). */
@Injectable()
export class PasswordPolicy {
  constructor(
    private readonly hasher: PasswordHasher,
    private readonly breached: BreachedPasswordChecker,
  ) {}

  async hashNew(password: string, email: string, field = 'password'): Promise<string> {
    const problems = passwordProblems(password, email);
    if (problems.length === 0 && (await this.breached.isBreached(password))) {
      problems.push('breached');
    }
    if (problems.length > 0) {
      throw new ValidationError(
        problems.map((code) => ({
          path: field,
          code: `password_${code}`,
          message: MESSAGES[code],
        })),
      );
    }
    return this.hasher.hash(password);
  }
}
