import type { Express, RequestHandler, Response } from "express";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import type { Session, User } from "../shared/model.js";
import type {
  DeliveredSession,
  LifecycleInfo,
  SessionLifecycle,
} from "../shared/lifecycle.js";
import {
  accessibleSessionRows,
  mappedSession,
  storedSession,
} from "./workspaces.js";
import { sessionCollaborators } from "./collaborators.js";
import { totalDuration } from "../shared/domain.js";
import { fail } from "./security.js";

const id = z.string().min(1).max(120),
  version = z.number().int().positive();
const who = (res: Response) => res.locals.user as User;
const RETENTION = 30 * 24 * 60 * 60 * 1000;
interface LifecycleRow {
  session_id: string;
  closed_at: string | null;
  closed_by: string | null;
  facilitators: string;
  deleted_at: string | null;
  deleted_by: string | null;
  expires_at: string | null;
}
export async function initializeLifecycle(db: Database) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS session_lifecycle(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,closed_at TEXT,closed_by TEXT REFERENCES users(id),facilitators TEXT NOT NULL DEFAULT '[]',deleted_at TEXT,deleted_by TEXT REFERENCES users(id),expires_at TEXT)",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS session_lifecycle_expiry_idx ON session_lifecycle(expires_at)",
  );
}
export async function getSessionLifecycle(sql: Sql, sessionId: string) {
  return (
    await sql.all<LifecycleRow>(
      "SELECT * FROM session_lifecycle WHERE session_id=$1",
      [sessionId],
    )
  )[0];
}
export async function guardSessionLifecycle(
  sql: Sql,
  sessionId: string,
  { write = false }: { write?: boolean } = {},
) {
  const state = await getSessionLifecycle(sql, sessionId);
  if (state?.deleted_at) return fail(404, "NOT_FOUND", "Session not found.");
  if (write && state?.closed_at)
    return fail(
      409,
      "SESSION_CLOSED",
      "This session is closed. An administrator must reopen it before changes can be made.",
    );
  return state;
}
export function lifecycleMetadata(row: {
  closed_at?: string | null;
  facilitators?: string | null;
}): SessionLifecycle | undefined {
  return row.closed_at
    ? {
        closedAt: row.closed_at,
        facilitatorIds: JSON.parse(row.facilitators ?? "[]"),
      }
    : undefined;
}
async function canAdmin(sql: Sql, session: Session, user: User) {
  if (session.ownerId === user.id || user.isAdmin) return true;
  if (!session.workspaceId) return false;
  const [member] = await sql.all<{ role: string }>(
    "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
    [session.workspaceId, user.id],
  );
  return member?.role === "admin";
}
async function lockSession(
  sql: Sql,
  sid: string,
  userId: string,
  expected?: number,
  includeDeleted = false,
) {
  if (
    !(await sql.run("UPDATE sessions SET version=version WHERE id=$1", [sid]))
  )
    return fail(404, "NOT_FOUND", "Session not found.");
  const [row] = await accessibleSessionRows(sql, userId, sid, includeDeleted);
  if (!row) return fail(404, "NOT_FOUND", "Session not found.");
  if (expected !== undefined && row.version !== expected)
    return fail(
      409,
      "VERSION_CONFLICT",
      "The session changed. Reload before continuing.",
    );
  return { session: mappedSession(row), role: row.role };
}
async function revision(sql: Sql, session: Session) {
  session.version++;
  session.updatedAt = new Date().toISOString();
  await sql.run(
    "UPDATE sessions SET payload=$1,version=$2,updated_at=$3 WHERE id=$4",
    [storedSession(session), session.version, session.updatedAt, session.id],
  );
}
async function purgeExpired(db: Database) {
  const rows = await db.all<{ session_id: string }>(
    "SELECT session_id FROM session_lifecycle WHERE expires_at<=$1 ORDER BY session_id LIMIT 25",
    [new Date().toISOString()],
  );
  for (const row of rows)
    await db.transaction(async (sql) => {
      await sql.run("UPDATE sessions SET version=version WHERE id=$1", [
        row.session_id,
      ]);
      const current = await getSessionLifecycle(sql, row.session_id);
      if (
        current?.deleted_at &&
        current.expires_at &&
        current.expires_at <= new Date().toISOString()
      )
        await sql.run("DELETE FROM sessions WHERE id=$1", [row.session_id]);
    });
}
async function facilitatorNames(sql: Sql, ids: string[]) {
  const result: { id: string; name: string }[] = [];
  for (const uid of ids) {
    const [user] = await sql.all<{ id: string; name: string }>(
      "SELECT id,name FROM users WHERE id=$1",
      [uid],
    );
    if (user) result.push(user);
  }
  return result;
}
export async function installLifecycleApi(
  app: Express,
  { db, authenticated }: { db: Database; authenticated: RequestHandler },
) {
  app.get("/api/sessions/:id/lifecycle", authenticated, async (req, res) => {
    const [row] = await accessibleSessionRows(
      db,
      who(res).id,
      id.parse(req.params.id),
    );
    if (!row) return fail(404, "NOT_FOUND", "Session not found.");
    const session = mappedSession(row),
      state = await guardSessionLifecycle(db, session.id),
      admin = await canAdmin(db, session, who(res));
    const result: LifecycleInfo = {
      closedAt: state?.closed_at ?? null,
      facilitators: await facilitatorNames(
        db,
        JSON.parse(state?.facilitators ?? "[]"),
      ),
      collaborators: await sessionCollaborators(db, session.id),
      canClose: !state?.closed_at && ["owner", "editor"].includes(row.role),
      canReopen: !!state?.closed_at && admin,
      canTrash: admin,
    };
    res.json(result);
  });
  app.post("/api/sessions/:id/lifecycle", authenticated, async (req, res) => {
    const sid = id.parse(req.params.id),
      input = z
        .object({
          action: z.enum(["close", "reopen"]),
          version,
          facilitatorIds: z.array(id).min(1).max(50).optional(),
        })
        .strict()
        .parse(req.body);
    await db.transaction(async (sql) => {
      const { session, role } = await lockSession(
          sql,
          sid,
          who(res).id,
          input.version,
        ),
        state = await guardSessionLifecycle(sql, sid);
      if (input.action === "close") {
        if (!["owner", "editor"].includes(role))
          return fail(
            403,
            "FORBIDDEN",
            "Only an editor can close the session.",
          );
        if (state?.closed_at)
          return fail(409, "SESSION_CLOSED", "This session is already closed.");
        if (["running", "paused"].includes(session.run.status))
          return fail(
            409,
            "ACTIVE_RUN",
            "Stop the timer before closing this session.",
          );
        const ids = [...new Set(input.facilitatorIds ?? [who(res).id])],
          collaborators = await sessionCollaborators(sql, sid);
        if (
          ids.some((uid) => !collaborators.some((person) => person.id === uid))
        )
          return fail(
            400,
            "INVALID_FACILITATOR",
            "Choose facilitators among current collaborators.",
          );
        const now = new Date().toISOString();
        await sql.run(
          "INSERT INTO session_lifecycle(session_id,closed_at,closed_by,facilitators) VALUES($1,$2,$3,$4) ON CONFLICT(session_id) DO UPDATE SET closed_at=excluded.closed_at,closed_by=excluded.closed_by,facilitators=excluded.facilitators",
          [sid, now, who(res).id, JSON.stringify(ids)],
        );
      } else {
        if (!(await canAdmin(sql, session, who(res))))
          return fail(
            403,
            "FORBIDDEN",
            "Only the owner or an administrator can reopen the session.",
          );
        if (!state?.closed_at)
          return fail(409, "SESSION_OPEN", "This session is already open.");
        await sql.run(
          "UPDATE session_lifecycle SET closed_at=NULL,closed_by=NULL,facilitators='[]' WHERE session_id=$1",
          [sid],
        );
      }
      await revision(sql, session);
    });
    const [row] = await accessibleSessionRows(db, who(res).id, sid);
    res.json({ session: mappedSession(row), role: row.role });
  });
  app.get("/api/reports/delivered", authenticated, async (req, res) => {
    const input = z
      .object({
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        facilitator: id.optional(),
        tag: z.string().max(80).optional(),
        workspaceId: id.optional(),
      })
      .parse(req.query);
    const rows = await accessibleSessionRows(db, who(res).id),
      sessions: DeliveredSession[] = [];
    for (const row of rows) {
      if (!row.closed_at) continue;
      const session = mappedSession(row),
        ids = session.lifecycle!.facilitatorIds;
      if (
        (input.from && row.closed_at.slice(0, 10) < input.from) ||
        (input.to && row.closed_at.slice(0, 10) > input.to) ||
        (input.facilitator && !ids.includes(input.facilitator)) ||
        (input.tag && !session.tags?.includes(input.tag)) ||
        (input.workspaceId && session.workspaceId !== input.workspaceId)
      )
        continue;
      const actual = Object.values(session.run.actualDurations ?? {});
      sessions.push({
        id: session.id,
        title: session.title,
        closedAt: row.closed_at,
        facilitators: await facilitatorNames(db, ids),
        tags: session.tags ?? [],
        workspaceId: session.workspaceId,
        plannedMinutes: totalDuration(session),
        actualMinutes: actual.length
          ? actual.reduce((sum, value) => sum + value, 0) / 60
          : null,
      });
    }
    sessions.sort((a, b) => b.closedAt.localeCompare(a.closedAt));
    res.json({
      sessions,
      totalPlannedMinutes: sessions.reduce(
        (sum, item) => sum + item.plannedMinutes,
        0,
      ),
      totalActualMinutes: sessions.reduce(
        (sum, item) => sum + (item.actualMinutes ?? 0),
        0,
      ),
    });
  });
  app.post("/api/sessions/:id/trash", authenticated, async (req, res) => {
    const sid = id.parse(req.params.id),
      input = z.object({ version }).strict().parse(req.body);
    await db.transaction(async (sql) => {
      const { session } = await lockSession(
        sql,
        sid,
        who(res).id,
        input.version,
      );
      if (!(await canAdmin(sql, session, who(res))))
        return fail(
          403,
          "FORBIDDEN",
          "Only the owner or an administrator can delete the session.",
        );
      if (["running", "paused"].includes(session.run.status))
        return fail(
          409,
          "ACTIVE_RUN",
          "Stop the timer before deleting the session.",
        );
      const now = new Date(),
        expiry = new Date(now.getTime() + RETENTION).toISOString();
      await sql.run(
        "INSERT INTO session_lifecycle(session_id,deleted_at,deleted_by,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(session_id) DO UPDATE SET deleted_at=excluded.deleted_at,deleted_by=excluded.deleted_by,expires_at=excluded.expires_at",
        [sid, now.toISOString(), who(res).id, expiry],
      );
      await revision(sql, session);
    });
    await purgeExpired(db);
    res.json({ ok: true, retentionDays: 30 });
  });
  app.get("/api/trash/sessions", authenticated, async (_req, res) => {
    await purgeExpired(db);
    const rows = await accessibleSessionRows(db, who(res).id, undefined, true),
      sessions = [];
    for (const row of rows) {
      if (!row.deleted_at || !row.expires_at) continue;
      const session = mappedSession(row);
      sessions.push({
        id: session.id,
        title: session.title,
        deletedAt: row.deleted_at,
        expiresAt: row.expires_at,
        version: session.version,
        workspaceId: session.workspaceId,
        canRestore: await canAdmin(db, session, who(res)),
      });
    }
    res.json({ sessions, retentionDays: 30 });
  });
  app.post(
    "/api/trash/sessions/:id/restore",
    authenticated,
    async (req, res) => {
      const sid = id.parse(req.params.id),
        input = z.object({ version }).strict().parse(req.body);
      await db.transaction(async (sql) => {
        const { session } = await lockSession(
          sql,
          sid,
          who(res).id,
          input.version,
          true,
        );
        if (!(await canAdmin(sql, session, who(res))))
          return fail(
            403,
            "FORBIDDEN",
            "Only the owner or an administrator can restore the session.",
          );
        const state = await getSessionLifecycle(sql, sid);
        if (
          !state?.deleted_at ||
          !state.expires_at ||
          state.expires_at <= new Date().toISOString()
        )
          return fail(
            410,
            "TRASH_EXPIRED",
            "This session can no longer be restored.",
          );
        await sql.run(
          "UPDATE session_lifecycle SET deleted_at=NULL,deleted_by=NULL,expires_at=NULL WHERE session_id=$1",
          [sid],
        );
        await revision(sql, session);
      });
      res.json({ ok: true });
    },
  );
}
