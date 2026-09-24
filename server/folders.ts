import type { Express, RequestHandler, Response } from "express";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import type { Session, User } from "../shared/model.js";
import {
  folderAncestors,
  folderPathSchema,
  normalizeFolder,
} from "../shared/folders.js";
import { storedSession, workspaceAccess } from "./workspaces.js";
import { fail } from "./security.js";

const wid = z.string().min(1).max(120).optional(),
  version = z.number().int().nonnegative();
const who = (res: Response) => (res.locals.user as User).id;
const scopeOf = (uid: string, workspaceId?: string) =>
  workspaceId ? `workspace:${workspaceId}` : `user:${uid}`;
const inTree = (path: string, root: string) =>
  path === root || path.startsWith(`${root}/`);
async function lockScope(sql: Sql, scope: string, expected?: number) {
  await sql.run(
    "INSERT INTO folder_scopes(id,version) VALUES($1,0) ON CONFLICT(id) DO NOTHING",
    [scope],
  );
  await sql.run("UPDATE folder_scopes SET version=version WHERE id=$1", [
    scope,
  ]);
  const [row] = await sql.all<{ version: number }>(
    "SELECT version FROM folder_scopes WHERE id=$1",
    [scope],
  );
  if (expected !== undefined && expected !== row.version)
    return fail(
      409,
      "FOLDER_CONFLICT",
      "Folders changed. Reload before continuing.",
    );
  return row.version;
}
async function ensure(sql: Sql, scope: string, path: string) {
  for (const parent of folderAncestors(path))
    await sql.run(
      "INSERT INTO folders(scope,path) VALUES($1,$2) ON CONFLICT(scope,path) DO NOTHING",
      [scope, parent],
    );
}
async function scopeSessionRows(sql: Sql, uid: string, workspaceId?: string) {
  return sql.all<{ id: string; payload: string; version: number }>(
    `SELECT s.id,s.payload,s.version FROM sessions s LEFT JOIN session_workspaces sw ON sw.session_id=s.id LEFT JOIN session_lifecycle l ON l.session_id=s.id WHERE ${workspaceId ? "sw.workspace_id=$1" : "s.owner_id=$1 AND sw.workspace_id IS NULL"} AND l.deleted_at IS NULL ORDER BY s.id`,
    [workspaceId ?? uid],
  );
}
async function permitted(
  sql: Sql,
  uid: string,
  workspaceId?: string,
  write = false,
) {
  if (!workspaceId) return true;
  const access = await workspaceAccess(
    sql,
    workspaceId,
    uid,
    write ? ["admin", "editor"] : undefined,
  );
  return access.role !== "viewer";
}
export async function recordSessionFolders(
  sql: Sql,
  previous: Session | undefined,
  next: Session,
) {
  const paths = [previous, next]
    .filter((session): session is Session => !!session && !!session.folder)
    .map((session) => ({
      scope: scopeOf(session.ownerId, session.workspaceId),
      path: normalizeFolder(session.folder!),
    }));
  // A regular content edit needs no folder lock. This avoids unnecessary contention.
  if (
    previous &&
    previous.folder === next.folder &&
    previous.workspaceId === next.workspaceId
  )
    return;
  for (const scope of [...new Set(paths.map((value) => value.scope))].sort()) {
    await lockScope(sql, scope);
    for (const value of paths.filter((value) => value.scope === scope))
      await ensure(sql, scope, value.path);
    await sql.run("UPDATE folder_scopes SET version=version+1 WHERE id=$1", [
      scope,
    ]);
  }
}
export async function initializeFolders(db: Database) {
  await db.transaction(async (sql) => {
    await sql.run(
      "CREATE TABLE IF NOT EXISTS folder_scopes(id TEXT PRIMARY KEY,version INTEGER NOT NULL)",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS folders(scope TEXT NOT NULL REFERENCES folder_scopes(id) ON DELETE CASCADE,path TEXT NOT NULL,PRIMARY KEY(scope,path))",
    );
    const [migration] = await sql.all(
      "SELECT id FROM app_settings WHERE id=$1",
      ["folder-registry-v1"],
    );
    if (migration) return;
    const rows = await sql.all<{
      payload: string;
      workspace_id: string | null;
    }>(
      "SELECT s.payload,sw.workspace_id FROM sessions s LEFT JOIN session_workspaces sw ON sw.session_id=s.id",
    );
    for (const row of rows) {
      const session = JSON.parse(row.payload) as Session;
      session.workspaceId = row.workspace_id ?? undefined;
      await recordSessionFolders(sql, undefined, session);
    }
    await sql.run(
      "INSERT INTO app_settings(id,payload) VALUES($1,$2) ON CONFLICT(id) DO NOTHING",
      ["folder-registry-v1", "true"],
    );
  });
}
export async function installFoldersApi(
  app: Express,
  { db, authenticated }: { db: Database; authenticated: RequestHandler },
) {
  app.get("/api/folders", authenticated, async (req, res) => {
    const input = z.object({ workspaceId: wid }).parse(req.query),
      editable = await permitted(db, who(res), input.workspaceId),
      scope = scopeOf(who(res), input.workspaceId);
    const [state] = await db.all<{ version: number }>(
        "SELECT version FROM folder_scopes WHERE id=$1",
        [scope],
      ),
      rows = await db.all<{ path: string }>(
        "SELECT path FROM folders WHERE scope=$1 ORDER BY path",
        [scope],
      );
    const sessions = await scopeSessionRows(db, who(res), input.workspaceId),
      paths = new Set(rows.map((row) => row.path));
    for (const row of sessions)
      for (const path of folderAncestors(
        normalizeFolder((JSON.parse(row.payload) as Session).folder ?? ""),
      ))
        paths.add(path);
    res.json({
      version: state?.version ?? 0,
      folders: [...paths].sort(),
      editable,
      workspaceId: input.workspaceId,
    });
  });
  app.post("/api/folders", authenticated, async (req, res) => {
    const input = z
        .object({ workspaceId: wid, version, path: folderPathSchema })
        .strict()
        .parse(req.body),
      scope = scopeOf(who(res), input.workspaceId);
    await db.transaction(async (sql) => {
      await permitted(sql, who(res), input.workspaceId, true);
      await lockScope(sql, scope, input.version);
      if (
        (
          await sql.all("SELECT path FROM folders WHERE scope=$1 AND path=$2", [
            scope,
            input.path,
          ])
        ).length
      )
        return fail(409, "FOLDER_EXISTS", "A folder already has that name.");
      await ensure(sql, scope, input.path);
      await sql.run("UPDATE folder_scopes SET version=version+1 WHERE id=$1", [
        scope,
      ]);
    });
    res.status(201).json({ ok: true });
  });
  app.patch("/api/folders", authenticated, async (req, res) => {
    const input = z
        .object({
          workspaceId: wid,
          version,
          source: folderPathSchema,
          path: folderPathSchema,
        })
        .strict()
        .parse(req.body),
      scope = scopeOf(who(res), input.workspaceId);
    if (inTree(input.path, input.source))
      return fail(
        400,
        "FOLDER_SELF",
        "Choose a destination outside this folder.",
      );
    await db.transaction(async (sql) => {
      await permitted(sql, who(res), input.workspaceId, true);
      await lockScope(sql, scope, input.version);
      const folders = await sql.all<{ path: string }>(
          "SELECT path FROM folders WHERE scope=$1",
          [scope],
        ),
        sessions = await scopeSessionRows(sql, who(res), input.workspaceId),
        paths = new Set(folders.map((folder) => folder.path));
      for (const row of sessions)
        for (const path of folderAncestors(
          normalizeFolder((JSON.parse(row.payload) as Session).folder ?? ""),
        ))
          paths.add(path);
      if (!paths.has(input.source))
        return fail(404, "NOT_FOUND", "Folder not found.");
      if (
        [...paths].some(
          (path) => inTree(path, input.path) && !inTree(path, input.source),
        )
      )
        return fail(
          409,
          "FOLDER_EXISTS",
          "The destination folder already exists.",
        );
      const renames = [...paths]
        .filter((path) => inTree(path, input.source))
        .map((path) => ({
          source: path,
          target: folderPathSchema.parse(
            input.path + path.slice(input.source.length),
          ),
        }));
      for (const value of renames)
        await sql.run("DELETE FROM folders WHERE scope=$1 AND path=$2", [
          scope,
          value.source,
        ]);
      for (const value of renames) await ensure(sql, scope, value.target);
      for (const row of sessions) {
        const session = JSON.parse(row.payload) as Session,
          path = normalizeFolder(session.folder ?? "");
        if (!inTree(path, input.source)) continue;
        session.folder = folderPathSchema.parse(
          input.path + path.slice(input.source.length),
        );
        session.version++;
        session.updatedAt = new Date().toISOString();
        if (
          !(await sql.run(
            "UPDATE sessions SET payload=$1,version=$2,updated_at=$3 WHERE id=$4 AND version=$5",
            [
              storedSession(session),
              session.version,
              session.updatedAt,
              row.id,
              row.version,
            ],
          ))
        )
          return fail(
            409,
            "VERSION_CONFLICT",
            "A session changed while renaming. Retry.",
          );
      }
      await sql.run("UPDATE folder_scopes SET version=version+1 WHERE id=$1", [
        scope,
      ]);
    });
    res.json({ ok: true });
  });
  app.delete("/api/folders", authenticated, async (req, res) => {
    const input = z
        .object({ workspaceId: wid, version, path: folderPathSchema })
        .strict()
        .parse(req.body),
      scope = scopeOf(who(res), input.workspaceId);
    await db.transaction(async (sql) => {
      await permitted(sql, who(res), input.workspaceId, true);
      await lockScope(sql, scope, input.version);
      const sessions = await scopeSessionRows(sql, who(res), input.workspaceId);
      if (
        sessions.some((row) =>
          inTree(
            normalizeFolder((JSON.parse(row.payload) as Session).folder ?? ""),
            input.path,
          ),
        )
      )
        return fail(
          409,
          "FOLDER_NOT_EMPTY",
          "Move the folder’s sessions, including archived sessions, before deleting it.",
        );
      const folders = await sql.all<{ path: string }>(
        "SELECT path FROM folders WHERE scope=$1",
        [scope],
      );
      const removal = folders.filter((folder) =>
        inTree(folder.path, input.path),
      );
      if (!removal.length) return fail(404, "NOT_FOUND", "Folder not found.");
      for (const folder of removal)
        await sql.run("DELETE FROM folders WHERE scope=$1 AND path=$2", [
          scope,
          folder.path,
        ]);
      await sql.run("UPDATE folder_scopes SET version=version+1 WHERE id=$1", [
        scope,
      ]);
    });
    res.json({ ok: true });
  });
}
