import type { Express, RequestHandler } from "express";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import type { Role, Session, User } from "../shared/model.js";
import { fail } from "./security.js";

export async function installActivityApi(
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
      roles?: Role[],
    ) => Promise<{ session: Session; role: Role }>;
  },
) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS session_views(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,version INTEGER NOT NULL,viewed_at TEXT NOT NULL,PRIMARY KEY(session_id,user_id))",
  );
  app.post("/api/sessions/:id/view", authenticated, async (req, res) => {
    const sid = z.string().min(1).max(120).parse(req.params.id),
      { version } = z
        .object({ version: z.number().int().positive() })
        .strict()
        .parse(req.body),
      uid = (res.locals.user as User).id;
    const { session } = await accessible(sid, uid);
    if (version > session.version)
      return fail(
        400,
        "INVALID_VIEW_VERSION",
        "Cannot mark unseen future changes as read.",
      );
    await db.run(
      "INSERT INTO session_views(session_id,user_id,version,viewed_at) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,user_id) DO UPDATE SET version=CASE WHEN session_views.version<excluded.version THEN excluded.version ELSE session_views.version END,viewed_at=excluded.viewed_at",
      [sid, uid, version, new Date().toISOString()],
    );
    res.json({ ok: true });
  });
}
export async function sessionReadMarkers(sql: Sql, userId: string) {
  const rows = await sql.all<{
    session_id: string;
    version: number;
    viewed_at: string;
  }>(
    "SELECT session_id,version,viewed_at FROM session_views WHERE user_id=$1",
    [userId],
  );
  return new Map(rows.map((row) => [row.session_id, row]));
}
