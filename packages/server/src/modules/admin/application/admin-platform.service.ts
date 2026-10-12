import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { Actor } from '../../../kernel/context/request-context';
import { Database } from '../../../kernel/db/database';
import { ValidationError } from '../../../kernel/errors/app-error';
import { decodeCursor, encodeCursor, toPage } from '../../../kernel/http/cursor';
import { Clock } from '../../../kernel/time/clock';
import { AuditService, type AuditLogRow, type AuditSearch } from '../../audit/audit.public';
import {
  FeatureFlagAdmin,
  type FlagRow,
  type OverrideRow,
} from '../../feature-flags/feature-flags.public';

const DAY = 24 * 3_600_000;
const flagCursor = z.object({ k: z.string() });
const auditCursor = z
  .object({ t: z.iso.datetime(), id: z.uuid() })
  .transform((c) => ({ occurredAt: new Date(c.t), id: c.id }));

/** Feature flags and the audit trail in the admin console (FR-ADM-005, NFR-SEC-007). */
@Injectable()
export class AdminPlatformService {
  constructor(
    private readonly db: Database,
    private readonly flags: FeatureFlagAdmin,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  listFlags(page: { limit: number; cursor?: string | undefined; includeArchived: boolean }) {
    return this.db.transaction(async (tx) => {
      const rows = await this.flags.list(tx, {
        limit: page.limit + 1,
        afterKey: decodeCursor(page.cursor, flagCursor)?.k,
        includeArchived: page.includeArchived,
      });
      return toPage(rows, page.limit, toFlag, (r) => encodeCursor({ k: r.key }));
    });
  }

  createFlag(actor: Actor, input: Parameters<FeatureFlagAdmin['create']>[2]) {
    return this.db.transaction(async (tx) => toFlag(await this.flags.create(tx, actor, input)));
  }

  updateFlag(actor: Actor, id: string, changes: Parameters<FeatureFlagAdmin['update']>[3]) {
    return this.db.transaction(async (tx) =>
      toFlag(await this.flags.update(tx, actor, id, changes)),
    );
  }

  listOverrides(flagId: string) {
    return this.db.transaction(async (tx) => ({
      data: (await this.flags.listOverrides(tx, flagId)).map(toOverride),
    }));
  }

  setOverride(
    actor: Actor,
    flagId: string,
    input: {
      scopeType: OverrideRow['scopeType'];
      scopeId: string;
      value: unknown;
      expiresAt: string | null;
    },
  ) {
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= this.clock.now()) {
      throw new ValidationError([
        { path: 'expiresAt', code: 'in_past', message: 'Must be in the future' },
      ]);
    }
    return this.db.transaction(async (tx) =>
      toOverride(await this.flags.setOverride(tx, actor, flagId, { ...input, expiresAt })),
    );
  }

  deleteOverride(actor: Actor, flagId: string, overrideId: string) {
    return this.db.transaction((tx) => this.flags.deleteOverride(tx, actor, flagId, overrideId));
  }

  /** Newest first; defaults to the last 30 days. Platform scope: spans every tenant. */
  searchAudit(
    actor: Actor,
    query: Omit<AuditSearch, 'from' | 'to' | 'before'> & {
      from?: string | undefined;
      to?: string | undefined;
      cursor?: string | undefined;
    },
  ) {
    const to = query.to ? new Date(query.to) : this.clock.now();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * DAY);
    if (from > to) {
      throw new ValidationError([{ path: 'from', code: 'invalid_range', message: 'from > to' }]);
    }
    const { cursor, ...filter } = query;
    return this.db.platformTx({ actor, reason: 'admin audit log search' }, async (tx) => {
      const rows = await this.audit.search(tx, {
        ...filter,
        from,
        to,
        limit: query.limit + 1,
        before: decodeCursor(cursor, auditCursor),
      });
      return toPage(rows, query.limit, toAuditEntry, (r) =>
        encodeCursor({ t: r.occurredAt.toISOString(), id: r.id }),
      );
    });
  }
}

function toFlag(row: FlagRow) {
  return {
    id: row.id,
    key: row.key,
    description: row.description,
    type: row.type,
    defaultValue: row.defaultValue as z.core.util.JSONType,
    rolloutPercent: row.rolloutPercent,
    isArchived: row.isArchived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toOverride(row: OverrideRow) {
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    value: row.value as z.core.util.JSONType,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    setByPlatformAdminId: row.setByPlatformAdminId,
    createdAt: row.createdAt.toISOString(),
  };
}

function toAuditEntry(row: AuditLogRow) {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    organizationId: row.organizationId,
    locationId: row.locationId,
    actorType: row.actorType,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    changes: row.changes as Record<string, z.core.util.JSONType>,
    context: row.context as Record<string, z.core.util.JSONType>,
    requestId: row.requestId,
    ip: row.ip,
  };
}
