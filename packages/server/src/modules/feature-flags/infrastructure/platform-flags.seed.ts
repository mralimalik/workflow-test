import type { Pool } from 'pg';

import type { Seed } from '../../../kernel/db/seeds/seed';
import { newId } from '../../../kernel/ids/ids';

/**
 * Flags the code reads, with their initial definition. Inserted once; afterwards platform
 * admins own the values (a re-run never overwrites an edited flag).
 */
export const PLATFORM_FLAGS = [
  {
    key: 'auth.login_alert_email',
    description:
      'Email users when their account signs in from a new device. Users opt out with a user override set to false.',
    defaultValue: true,
  },
] as const;

export const platformFlagsSeed: Seed = {
  name: 'feature-flags',
  environments: ['local', 'dev', 'staging', 'production'],
  async run(pool: Pool) {
    for (const flag of PLATFORM_FLAGS) {
      await pool.query(
        `insert into feature_flags (id, key, description, type, default_value)
         values ($1, $2, $3, 'boolean', $4::jsonb)
         on conflict (key) do nothing`,
        [newId(), flag.key, flag.description, JSON.stringify(flag.defaultValue)],
      );
    }
  },
};
