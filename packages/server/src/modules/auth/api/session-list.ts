import type { SessionService, ActiveSession } from '../application/session.service';

/** `GET /auth/{realm}/sessions` body: the subject's active sessions, newest activity first. */
export async function listSessions(sessions: SessionService, current: ActiveSession) {
  const rows = await sessions.list(current.realm, current.subjectId);
  return {
    data: rows.map((row) => ({
      id: row.id,
      current: row.id === current.id,
      authMethod: row.authMethod,
      deviceLabel: row.deviceLabel,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    })),
  };
}
