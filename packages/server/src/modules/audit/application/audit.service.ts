import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, lt, lte, or } from 'drizzle-orm';

import { RequestContext, type Actor } from '../../../kernel/context/request-context';
import type { Tx } from '../../../kernel/db/database';
import type { AuditLogRow } from '../infrastructure/audit.partitioned';
import { newId } from '../../../kernel/ids/ids';
import { sanitizeLogObject } from '../../../kernel/logging/sanitize';
import { auditLogs } from '../infrastructure/audit.partitioned';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditSearch {
  organizationId?: string | undefined;
  actorType?: string | undefined;
  actorId?: string | undefined;
  action?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  from: Date;
  to: Date;
  limit: number;
  /** Keyset: rows strictly older than this (occurred_at, id). */
  before?: { occurredAt: Date; id: string } | undefined;
}

export interface AuditEntry {
  /** `<resource>.<verb>`: `organization.created`, `member.role_changed`, `auth.login_failed`. */
  action: string;
  organizationId?: string | null;
  locationId?: string | null;
  /** Defaults to the request's actor; `system` when there is none. */
  actor?: Actor;
  target?: { type: string; id: string };
  /** Field diff `{ field: [old, new] }`; secrets and PII are masked before storage. */
  changes?: Record<string, [unknown, unknown]>;
  context?: Record<string, unknown>;
}

/**
 * Append-only audit trail (NFR-SEC-007, data model 14). Written inside the caller's
 * transaction so the record exists if and only if the change committed.
 */
@Injectable()
export class AuditService {
  async record(tx: Tx, entry: AuditEntry): Promise<void> {
    const ctx = RequestContext.get();
    const actor = entry.actor ?? ctx?.actor ?? { type: 'system', id: 'system' };
    await tx.insert(auditLogs).values({
      id: newId(),
      organizationId: entry.organizationId ?? null,
      locationId: entry.locationId ?? null,
      actorType: actor.type,
      actorId: UUID.test(actor.id) ? actor.id : null,
      action: entry.action,
      targetType: entry.target?.type ?? null,
      targetId: entry.target?.id ?? null,
      changes: (entry.changes ? sanitizeLogObject(entry.changes) : {}) as Record<
        string,
        [unknown, unknown]
      >,
      context: entry.context ? sanitizeLogObject(entry.context) : {},
      requestId: ctx?.requestId ?? null,
      ip: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    });
  }

  /**
   * Reads the trail across tenants (admin console). Requires a platform-scope transaction:
   * the `platform_scope` policy is the only one that exposes every row.
   */
  async search(tx: Tx, filter: AuditSearch): Promise<AuditLogRow[]> {
    const before = filter.before;
    return tx
      .select()
      .from(auditLogs)
      .where(
        and(
          gte(auditLogs.occurredAt, filter.from),
          lte(auditLogs.occurredAt, filter.to),
          filter.organizationId ? eq(auditLogs.organizationId, filter.organizationId) : undefined,
          filter.actorType ? eq(auditLogs.actorType, filter.actorType) : undefined,
          filter.actorId ? eq(auditLogs.actorId, filter.actorId) : undefined,
          filter.action ? eq(auditLogs.action, filter.action) : undefined,
          filter.targetType ? eq(auditLogs.targetType, filter.targetType) : undefined,
          filter.targetId ? eq(auditLogs.targetId, filter.targetId) : undefined,
          before
            ? or(
                lt(auditLogs.occurredAt, before.occurredAt),
                and(eq(auditLogs.occurredAt, before.occurredAt), lt(auditLogs.id, before.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(auditLogs.occurredAt), desc(auditLogs.id))
      .limit(filter.limit);
  }
}
