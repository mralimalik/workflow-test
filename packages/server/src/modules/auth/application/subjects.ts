import type { Realm } from '@attendra/contracts';
import { Injectable } from '@nestjs/common';

import type { Tx } from '../../../kernel/db/database';
import { UsersService } from '../../users/users.public';

/** What authentication needs to know about a subject, whatever its realm. */
export interface AuthSubject {
  id: string;
  realm: Realm;
  email: string | null;
  status: 'active' | 'disabled' | 'banned' | 'deleted';
  sessionVersion: number;
  /** An organization (or the realm) requires a second factor. */
  mfaRequired: boolean;
}

/**
 * Looks up subjects by realm. Each realm's table is owned by its module (`users`, later
 * `platform-admins` and `customers`); this is the only place auth reads them.
 */
@Injectable()
export class Subjects {
  constructor(private readonly users: UsersService) {}

  async find(tx: Tx, realm: Realm, id: string): Promise<AuthSubject | null> {
    switch (realm) {
      case 'user': {
        const user = await this.users.findById(tx, id);
        return user
          ? {
              id: user.id,
              realm,
              email: user.email,
              status: user.status,
              sessionVersion: user.sessionVersion,
              mfaRequired: user.mfaRequired,
            }
          : null;
      }
      default:
        // Platform admins (A5) and customers (Phase 1) register here when they exist.
        return null;
    }
  }
}
