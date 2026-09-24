import type { Express, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import type { Role, Session, User } from "../shared/model.js";
import {
  workspaceSettingsSchema,
  type Workspace,
  type WorkspaceRole,
} from "../shared/workspaces.js";
import { sessionInputSchema } from "../shared/validation.js";
import { cloneContent } from "../shared/content.js";
import { fail, hashToken, token } from "./security.js";
import { lifecycleMetadata, guardSessionLifecycle } from "./lifecycle.js";
import { recordSessionFolders } from "./folders.js";

const id = z.string().min(1).max(120);
const role = z.enum(["admin", "editor", "viewer"]);
const who = (res: Response) => (res.locals.user as User).id;
type WorkspaceRow = {
  id: string;
  name: string;
  settings: string;
  version: number;
  created_at: string;
};
const workspaceOf = (row: WorkspaceRow): Workspace => ({
  id: row.id,
  name: row.name,
  settings: JSON.parse(row.settings),
  version: row.version,
  createdAt: row.created_at,
});
export async function workspaceAccess(
  sql: Sql,
  workspaceId: string,
  userId: string,
  allowedRoles?: WorkspaceRole[],
) {
  const [row] = await sql.all<WorkspaceRow & { role: WorkspaceRole }>(
    `SELECT w.*,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id AND m.user_id=$2 WHERE w.id=$1`,
    [workspaceId, userId],
  );
  if (!row) return fail(404, "NOT_FOUND", "Workspace not found.");
  if (allowedRoles && !allowedRoles.includes(row.role))
    return fail(
      403,
      "FORBIDDEN",
      "Your workspace role does not permit this action.",
    );
  return { workspace: workspaceOf(row), role: row.role };
}
async function lockedAccess(
  sql: Sql,
  workspaceId: string,
  userId: string,
  roles: WorkspaceRole[] = ["admin"],
) {
  // Membership and settings mutations serialize on the same row on PostgreSQL.
  await sql.run("UPDATE workspaces SET version=version WHERE id=$1", [
    workspaceId,
  ]);
  return workspaceAccess(sql, workspaceId, userId, roles);
}
export type AccessibleSessionRow = {
  id: string;
  owner_id: string;
  payload: string;
  version: number;
  role: Role;
  workspace_id: string | null;
  closed_at: string | null;
  facilitators: string;
  deleted_at: string | null;
  expires_at: string | null;
};
export async function accessibleSessionRows(
  sql: Sql,
  userId: string,
  sessionId?: string,
  includeDeleted = false,
) {
  return sql.all<AccessibleSessionRow>(
    `SELECT s.*,sw.workspace_id,l.closed_at,l.facilitators,l.deleted_at,l.expires_at,CASE WHEN s.owner_id=$1 THEN 'owner' WHEN wm.role IN ('admin','editor') OR m.role='editor' THEN 'editor' WHEN m.role='facilitator' THEN 'facilitator' ELSE 'viewer' END AS role FROM sessions s LEFT JOIN members m ON m.session_id=s.id AND m.user_id=$1 LEFT JOIN session_workspaces sw ON sw.session_id=s.id LEFT JOIN workspace_members wm ON wm.workspace_id=sw.workspace_id AND wm.user_id=$1 LEFT JOIN session_lifecycle l ON l.session_id=s.id WHERE (s.owner_id=$1 OR m.user_id=$1 OR wm.user_id=$1) ${includeDeleted ? "" : "AND l.deleted_at IS NULL"} ${sessionId ? "AND s.id=$2" : ""} ORDER BY s.updated_at DESC`,
    sessionId ? [userId, sessionId] : [userId],
  );
}
export function mappedSession(row: {
  payload: string;
  workspace_id: string | null;
  closed_at?: string | null;
  facilitators?: string | null;
}): Session {
  const session = JSON.parse(row.payload) as Session;
  delete session.workspaceId;
  if (row.workspace_id) session.workspaceId = row.workspace_id;
  session.lifecycle = lifecycleMetadata(row);
  return session;
}
export function storedSession(session: Session) {
  const { workspaceId: _mapping, lifecycle: _lifecycle, ...document } = session;
  return JSON.stringify(document);
}
export async function applyWorkspaceDefaults(
  sql: Sql,
  session: Session,
  workspaceId: string,
  userId: string,
) {
  const { workspace } = await lockedAccess(sql, workspaceId, userId, [
    "admin",
    "editor",
  ]);
  const defaults = workspace.settings.defaults;
  const { export: _export, startTime, ...fields } = defaults;
  const candidate = { ...session, ...fields };
  if (startTime)
    candidate.days = candidate.days.map((day) => ({ ...day, startTime }));
  // Every page/form receives its own IDs; invitations and publications are never copied.
  const content = cloneContent(candidate);
  Object.assign(candidate, content);
  if (fields.columns) {
    const columns = new Set(fields.columns.map((column) => column.id));
    const repair = (blocks: Session["days"][number]["blocks"]) => {
      for (const block of blocks) {
        block.fields = Object.fromEntries(
          Object.entries(block.fields).filter(([key]) => columns.has(key)),
        );
        if (block.children) repair(block.children);
        for (const room of block.rooms ?? []) repair(room.blocks);
      }
    };
    candidate.days.forEach((day) => repair(day.blocks));
  }
  return { ...sessionInputSchema.parse(candidate), workspaceId };
}
export async function acceptWorkspaceInvite(
  sql: Sql,
  hash: string,
  userId: string,
) {
  const [invite] = await sql.all<{
    workspace_id: string;
    role: WorkspaceRole;
    created_by: string;
  }>(
    "SELECT workspace_id,role,created_by FROM workspace_invitations WHERE token_hash=$1",
    [hash],
  );
  if (!invite) return;
  await lockedAccess(sql, invite.workspace_id, invite.created_by);
  if (
    (
      await sql.all("SELECT user_id FROM account_disabled WHERE user_id=$1", [
        invite.created_by,
      ])
    ).length
  )
    return fail(
      410,
      "INVITE_INVALID",
      "The workspace invitation is no longer valid.",
    );
  await sql.run(
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO NOTHING",
    [invite.workspace_id, userId, invite.role],
  );
  await sql.run("DELETE FROM workspace_invitations WHERE token_hash=$1", [
    hash,
  ]);
}
export async function removeAccountMembership(
  sql: Sql,
  userId: string,
  transferTo?: string,
) {
  const rows = await sql.all<{ workspace_id: string }>(
    "SELECT workspace_id FROM workspace_members WHERE user_id=$1 ORDER BY workspace_id",
    [userId],
  );
  for (const row of rows) {
    await sql.run("UPDATE workspaces SET version=version WHERE id=$1", [
      row.workspace_id,
    ]);
    const [member] = await sql.all<{ role: WorkspaceRole }>(
      "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
      [row.workspace_id, userId],
    );
    const others = await sql.all(
      "SELECT m.user_id FROM workspace_members m WHERE m.workspace_id=$1 AND m.user_id<>$2 AND m.role='admin' AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=m.user_id)",
      [row.workspace_id, userId],
    );
    if (member?.role === "admin" && !others.length) {
      if (
        !transferTo ||
        transferTo === userId ||
        !(
          await sql.all(
            "SELECT id FROM users WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
            [transferTo],
          )
        ).length
      )
        return fail(
          409,
          "LAST_WORKSPACE_ADMIN",
          "Transfer your workspaces to an active account before leaving.",
        );
      await sql.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin') ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=excluded.role",
        [row.workspace_id, transferTo],
      );
    }
  }
  await sql.run("DELETE FROM workspace_members WHERE user_id=$1", [userId]);
  await sql.run(
    "DELETE FROM invites WHERE token_hash IN (SELECT token_hash FROM workspace_invitations WHERE created_by=$1)",
    [userId],
  );
  await sql.run("DELETE FROM workspace_invitations WHERE created_by=$1", [
    userId,
  ]);
}

export async function installWorkspacesApi(
  app: Express,
  {
    db,
    authenticated,
    accessible,
  }: {
    db: Database;
    authenticated: RequestHandler;
    accessible: (
      id: string,
      userId: string,
      allowed?: Role[],
    ) => Promise<{ session: Session; role: Role }>;
  },
) {
  await db.transaction(async (sql) => {
    await sql.run(
      "CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY,name TEXT NOT NULL,settings TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL)",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS workspace_members(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),PRIMARY KEY(workspace_id,user_id))",
    );
    await sql.run(
      "CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id)",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS session_workspaces(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,workspace_id TEXT NOT NULL REFERENCES workspaces(id))",
    );
    await sql.run(
      "CREATE INDEX IF NOT EXISTS session_workspaces_space_idx ON session_workspaces(workspace_id)",
    );
    // Independent of invites FK: account acceptance consumes the invite atomically first.
    await sql.run(
      "CREATE TABLE IF NOT EXISTS workspace_invitations(token_hash TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,role TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id))",
    );
  });
  app.get("/api/workspaces", authenticated, async (_req, res) => {
    const rows = await db.all<WorkspaceRow & { role: WorkspaceRole | "guest" }>(
      `SELECT w.*,COALESCE(wm.role,'guest') AS role FROM workspaces w LEFT JOIN workspace_members wm ON wm.workspace_id=w.id AND wm.user_id=$1 WHERE wm.user_id=$1 OR EXISTS(SELECT 1 FROM session_workspaces sw JOIN sessions s ON s.id=sw.session_id LEFT JOIN members m ON m.session_id=s.id AND m.user_id=$1 WHERE sw.workspace_id=w.id AND (m.user_id=$1 OR s.owner_id=$1)) ORDER BY w.name`,
      [who(res)],
    );
    res.json({
      workspaces: rows.map((row) => {
        const w = workspaceOf(row);
        return {
          id: w.id,
          name: w.name,
          role: row.role,
          version: w.version,
          organization: w.settings.organization,
          logo: w.settings.logo,
        };
      }),
    });
  });
  app.post("/api/workspaces", authenticated, async (req, res) => {
    const input = z
      .object({ name: z.string().trim().min(1).max(200) })
      .strict()
      .parse(req.body);
    const workspace: Workspace = {
      id: randomUUID(),
      name: input.name,
      settings: { organization: "", defaults: {} },
      version: 1,
      createdAt: new Date().toISOString(),
    };
    await db.transaction(async (sql) => {
      await sql.run(
        "INSERT INTO workspaces(id,name,settings,version,created_at) VALUES($1,$2,$3,1,$4)",
        [
          workspace.id,
          workspace.name,
          JSON.stringify(workspace.settings),
          workspace.createdAt,
        ],
      );
      await sql.run(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
        [workspace.id, who(res)],
      );
    });
    res.status(201).json({ workspace, role: "admin" });
  });
  app.get("/api/workspaces/:id", authenticated, async (req, res) =>
    res.json(await workspaceAccess(db, id.parse(req.params.id), who(res))),
  );
  app.put("/api/workspaces/:id", authenticated, async (req, res) => {
    const wid = id.parse(req.params.id),
      input = z
        .object({
          name: z.string().trim().min(1).max(200),
          version: z.number().int().positive(),
          settings: workspaceSettingsSchema,
        })
        .strict()
        .parse(req.body);
    const workspace = await db.transaction(async (sql) => {
      const { workspace } = await lockedAccess(sql, wid, who(res));
      if (workspace.version !== input.version)
        return fail(
          409,
          "VERSION_CONFLICT",
          "Workspace settings changed. Reload before saving.",
        );
      const updated = {
        ...workspace,
        name: input.name,
        settings: input.settings,
        version: workspace.version + 1,
      };
      await sql.run(
        "UPDATE workspaces SET name=$1,settings=$2,version=$3 WHERE id=$4",
        [updated.name, JSON.stringify(updated.settings), updated.version, wid],
      );
      return updated;
    });
    res.json({ workspace, role: "admin" });
  });
  app.delete("/api/workspaces/:id", authenticated, async (req, res) => {
    const wid = id.parse(req.params.id);
    await db.transaction(async (sql) => {
      await lockedAccess(sql, wid, who(res));
      if (
        (
          await sql.all(
            "SELECT session_id FROM session_workspaces WHERE workspace_id=$1",
            [wid],
          )
        ).length
      )
        return fail(
          409,
          "WORKSPACE_NOT_EMPTY",
          "Move all sessions out before deleting this workspace.",
        );
      await sql.run(
        "DELETE FROM invites WHERE token_hash IN (SELECT token_hash FROM workspace_invitations WHERE workspace_id=$1)",
        [wid],
      );
      await sql.run("DELETE FROM folder_scopes WHERE id=$1", [
        `workspace:${wid}`,
      ]);
      await sql.run("DELETE FROM workspaces WHERE id=$1", [wid]);
    });
    res.json({ ok: true });
  });
  app.get("/api/workspaces/:id/members", authenticated, async (req, res) => {
    const wid = id.parse(req.params.id);
    await workspaceAccess(db, wid, who(res), ["admin"]);
    const members = await db.all<{
      userId: string;
      name: string;
      email: string;
      role: WorkspaceRole | "guest";
    }>(
      `SELECT u.id AS "userId",u.name,u.email,COALESCE(wm.role,'guest') AS role FROM users u LEFT JOIN workspace_members wm ON wm.user_id=u.id AND wm.workspace_id=$1 WHERE NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=u.id) AND (wm.user_id IS NOT NULL OR EXISTS(SELECT 1 FROM session_workspaces sw JOIN sessions s ON s.id=sw.session_id LEFT JOIN members m ON m.session_id=s.id AND m.user_id=u.id WHERE sw.workspace_id=$1 AND (m.user_id=u.id OR s.owner_id=u.id))) ORDER BY u.name`,
      [wid],
    );
    const sessions = await db.all<{
      id: string;
      payload: string;
      owner_id: string;
    }>(
      "SELECT s.* FROM sessions s JOIN session_workspaces sw ON sw.session_id=s.id WHERE sw.workspace_id=$1",
      [wid],
    );
    const explicit = await db.all<{
      session_id: string;
      user_id: string;
      role: Role;
    }>(
      "SELECT m.* FROM members m JOIN session_workspaces sw ON sw.session_id=m.session_id WHERE sw.workspace_id=$1",
      [wid],
    );
    const invitations = await db.all<{
      id: string;
      email: string;
      role: WorkspaceRole;
      expiresAt: number;
    }>(
      'SELECT i.token_hash AS id,i.email,w.role,i.expires_at AS "expiresAt" FROM workspace_invitations w JOIN invites i ON i.token_hash=w.token_hash WHERE w.workspace_id=$1 AND i.expires_at>$2',
      [wid, Date.now()],
    );
    res.json({
      members: members.map((member) => ({
        ...member,
        sessions: sessions
          .filter(
            (session) =>
              member.role !== "guest" ||
              session.owner_id === member.userId ||
              explicit.some(
                (m) =>
                  m.user_id === member.userId && m.session_id === session.id,
              ),
          )
          .map((session) => ({
            id: session.id,
            title: (JSON.parse(session.payload) as Session).title,
            role:
              session.owner_id === member.userId
                ? "owner"
                : member.role === "admin" || member.role === "editor"
                  ? "editor"
                  : (explicit.find(
                      (m) =>
                        m.user_id === member.userId &&
                        m.session_id === session.id,
                    )?.role ?? "viewer"),
          })),
      })),
      invitations,
    });
  });
  app.post("/api/workspaces/:id/members", authenticated, async (req, res) => {
    const wid = id.parse(req.params.id),
      input = z
        .object({
          email: z
            .email()
            .max(254)
            .transform((value) => value.toLowerCase().trim()),
          role,
          name: z.string().trim().min(1).max(120).optional(),
        })
        .strict()
        .parse(req.body);
    const result = await db.transaction(async (sql) => {
      await lockedAccess(sql, wid, who(res));
      const [existing] = await sql.all<{ id: string }>(
        "SELECT id FROM users WHERE email=$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
        [input.email],
      );
      if (existing) {
        const [old] = await sql.all<{ role: WorkspaceRole }>(
          "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
          [wid, existing.id],
        );
        if (old)
          return fail(
            409,
            "MEMBER_EXISTS",
            "This account already belongs to the workspace. Change its role instead.",
          );
        await sql.run(
          "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3)",
          [wid, existing.id, input.role],
        );
        return { added: true };
      }
      if (
        (await sql.all("SELECT id FROM users WHERE email=$1", [input.email]))
          .length
      )
        return fail(400, "ACCOUNT_UNAVAILABLE", "This account is unavailable.");
      await sql.run(
        "DELETE FROM workspace_invitations WHERE token_hash NOT IN (SELECT token_hash FROM invites WHERE expires_at>$1)",
        [Date.now()],
      );
      // Do not revoke another administrator's outstanding invitation for this email.
      const raw = token(),
        hash = hashToken(raw),
        expiresAt = Date.now() + 72 * 60 * 60 * 1000;
      await sql.run(
        "INSERT INTO invites(token_hash,email,name,expires_at,created_by) VALUES($1,$2,$3,$4,$5)",
        [hash, input.email, input.name ?? input.email, expiresAt, who(res)],
      );
      await sql.run(
        "INSERT INTO workspace_invitations(token_hash,workspace_id,role,created_by) VALUES($1,$2,$3,$4)",
        [hash, wid, input.role, who(res)],
      );
      return { added: false, token: raw, expiresAt };
    });
    res.status(201).json(result);
  });
  app.patch(
    "/api/workspaces/:id/members/:userId",
    authenticated,
    async (req, res) => {
      const wid = id.parse(req.params.id),
        uid = id.parse(req.params.userId),
        input = z.object({ role }).strict().parse(req.body);
      await db.transaction(async (sql) => {
        await lockedAccess(sql, wid, who(res));
        await protectLastAdmin(sql, wid, uid, input.role);
        if (
          !(await sql.run(
            "UPDATE workspace_members SET role=$1 WHERE workspace_id=$2 AND user_id=$3",
            [input.role, wid, uid],
          ))
        )
          return fail(404, "NOT_FOUND", "Member not found.");
      });
      res.json({ ok: true });
    },
  );
  app.delete(
    "/api/workspaces/:id/members/:userId",
    authenticated,
    async (req, res) => {
      const wid = id.parse(req.params.id),
        uid = id.parse(req.params.userId);
      await db.transaction(async (sql) => {
        await lockedAccess(sql, wid, who(res));
        await protectLastAdmin(sql, wid, uid);
        if (
          (
            await sql.all(
              "SELECT s.id FROM sessions s JOIN session_workspaces sw ON sw.session_id=s.id WHERE sw.workspace_id=$1 AND s.owner_id=$2",
              [wid, uid],
            )
          ).length
        )
          return fail(
            409,
            "OWNED_SESSIONS",
            "Transfer or move this member’s owned sessions before removing their access.",
          );
        await sql.run(
          "DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
          [wid, uid],
        );
        await sql.run(
          "DELETE FROM members WHERE user_id=$1 AND session_id IN (SELECT session_id FROM session_workspaces WHERE workspace_id=$2)",
          [uid, wid],
        );
        await sql.run(
          "DELETE FROM invites WHERE token_hash IN (SELECT token_hash FROM workspace_invitations WHERE workspace_id=$1 AND created_by=$2)",
          [wid, uid],
        );
        await sql.run(
          "DELETE FROM workspace_invitations WHERE workspace_id=$1 AND created_by=$2",
          [wid, uid],
        );
      });
      res.json({ ok: true });
    },
  );
  app.delete(
    "/api/workspaces/:id/invitations/:inviteId",
    authenticated,
    async (req, res) => {
      const wid = id.parse(req.params.id),
        hash = id.parse(req.params.inviteId);
      await db.transaction(async (sql) => {
        await lockedAccess(sql, wid, who(res));
        if (
          !(await sql.run(
            "DELETE FROM workspace_invitations WHERE workspace_id=$1 AND token_hash=$2",
            [wid, hash],
          ))
        )
          return fail(404, "NOT_FOUND", "Invitation not found.");
        await sql.run("DELETE FROM invites WHERE token_hash=$1", [hash]);
      });
      res.json({ ok: true });
    },
  );
  app.get(
    "/api/sessions/:id/workspace-defaults",
    authenticated,
    async (req, res) => {
      const { session } = await accessible(id.parse(req.params.id), who(res));
      if (!session.workspaceId)
        return res.json({ export: { audience: "public", landscape: false } });
      const [row] = await db.all<WorkspaceRow>(
        "SELECT * FROM workspaces WHERE id=$1",
        [session.workspaceId],
      );
      // A guest receives only export preferences, never private page/form defaults.
      res.json({
        export: workspaceOf(row).settings.defaults.export ?? {
          audience: "public",
          landscape: false,
        },
      });
    },
  );
  app.put("/api/sessions/:id/workspace", authenticated, async (req, res) => {
    const sid = id.parse(req.params.id),
      input = z
        .object({
          workspaceId: id.nullable(),
          version: z.number().int().positive(),
        })
        .strict()
        .parse(req.body);
    await db.transaction(async (sql) => {
      const rows = await accessibleSessionRows(sql, who(res), sid),
        row = rows[0];
      if (!row) return fail(404, "NOT_FOUND", "Session not found.");
      // Only the owner may expose the agenda to a new audience or make it personal.
      if (row.owner_id !== who(res))
        return fail(
          403,
          "FORBIDDEN",
          "Only the session owner can move it between workspaces.",
        );
      for (const wid of [
        ...new Set(
          [row.workspace_id, input.workspaceId].filter(
            (value): value is string => !!value,
          ),
        ),
      ].sort())
        await lockedAccess(sql, wid, who(res), ["admin", "editor"]);
      const session = mappedSession(row);
      await guardSessionLifecycle(sql, session.id, { write: true });
      const previousSession = structuredClone(session);
      session.version++;
      session.updatedAt = new Date().toISOString();
      session.workspaceId = input.workspaceId ?? undefined;
      await recordSessionFolders(sql, previousSession, session);
      if (
        !(await sql.run(
          "UPDATE sessions SET payload=$1,version=$2,updated_at=$3 WHERE id=$4 AND version=$5",
          [
            storedSession(session),
            session.version,
            session.updatedAt,
            sid,
            input.version,
          ],
        ))
      )
        return fail(
          409,
          "VERSION_CONFLICT",
          "This agenda changed. Reload before moving it.",
        );
      await sql.run("DELETE FROM session_workspaces WHERE session_id=$1", [
        sid,
      ]);
      if (input.workspaceId)
        await sql.run(
          "INSERT INTO session_workspaces(session_id,workspace_id) VALUES($1,$2)",
          [sid, input.workspaceId],
        );
    });
    res.json(await accessible(sid, who(res)));
  });
}
async function protectLastAdmin(
  sql: Sql,
  wid: string,
  uid: string,
  nextRole?: WorkspaceRole,
) {
  if (nextRole === "admin") return;
  const [member] = await sql.all<{ role: WorkspaceRole }>(
    "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
    [wid, uid],
  );
  if (
    member?.role === "admin" &&
    !(
      await sql.all(
        "SELECT m.user_id FROM workspace_members m WHERE m.workspace_id=$1 AND m.user_id<>$2 AND m.role='admin' AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=m.user_id)",
        [wid, uid],
      )
    ).length
  )
    return fail(
      409,
      "LAST_WORKSPACE_ADMIN",
      "Keep at least one active workspace administrator.",
    );
}
