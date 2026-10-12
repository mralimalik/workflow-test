import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@attendra/contracts';

export type PasswordProblem = 'too_short' | 'too_long' | 'contains_email' | 'breached';

/**
 * Local password rules (features/auth-and-identity.md rule 2; NIST SP 800-63B: length and
 * a blocklist, no composition rules). The breach check is a separate async step.
 */
export function passwordProblems(password: string, email: string): PasswordProblem[] {
  const problems: PasswordProblem[] = [];
  // Code points, not UTF-16 units (an emoji counts once), as NIST SP 800-63B asks.
  const length = Array.from(password).length;
  if (length < PASSWORD_MIN_LENGTH) problems.push('too_short');
  if (length > PASSWORD_MAX_LENGTH) problems.push('too_long');
  const local = email.split('@')[0]?.toLowerCase() ?? '';
  const lower = password.toLowerCase();
  if (lower === email.toLowerCase() || (local.length >= 4 && lower.includes(local)))
    problems.push('contains_email');
  return problems;
}
