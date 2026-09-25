import { randomUUID } from "node:crypto";
import type { Database, Sql } from "./db.js";
import { sessionCollaborators } from "./collaborators.js";

/**
 * Notifications about what happens without a team member behind it: a
 * visitor's comment, a user's problem report. Grouped so a busy room does not
 * flood the bell: while a notification is unread, new events of the same
 * kind and session add to its count instead of creating another one.
 */
export type GroupedKind = "visitor-comments" | "feedback";

export async function createAppNotifications(db: Database) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS app_notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE, target_id TEXT, actor TEXT NOT NULL, count INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, read_at TEXT)",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS app_notifications_user_idx ON app_notifications(user_id,updated_at)",
  );
}

async function notifyGrouped(
  sql: Sql,
  recipients: string[],
  {
    kind,
    sessionId,
    targetId,
    actor,
  }: {
    kind: GroupedKind;
    sessionId: string | null;
    /** What the notification opens first: the first comment of the group. */
    targetId: string | null;
    actor: string;
  },
) {
  const now = new Date().toISOString();
  for (const userId of new Set(recipients)) {
    const [open] = await sql.all<{ id: string }>(
      `SELECT id FROM app_notifications WHERE user_id=$1 AND kind=$2 AND read_at IS NULL AND ${sessionId ? "session_id=$3" : "session_id IS NULL"}`,
      sessionId ? [userId, kind, sessionId] : [userId, kind],
    );
    if (open)
      await sql.run(
        "UPDATE app_notifications SET count=count+1,actor=$1,updated_at=$2 WHERE id=$3",
        [actor, now, open.id],
      );
    else
      await sql.run(
        "INSERT INTO app_notifications(id,user_id,kind,session_id,target_id,actor,count,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,1,$7,$7)",
        [randomUUID(), userId, kind, sessionId, targetId, actor, now],
      );
    // The same bounded inbox as team notifications.
    await sql.run(
      "DELETE FROM app_notifications WHERE user_id=$1 AND id NOT IN (SELECT id FROM app_notifications WHERE user_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 200)",
      [userId],
    );
  }
}

/** Organizers who answer visitors: owner, editors and facilitators. */
export async function notifyVisitorComment(
  sql: Sql,
  sessionId: string,
  comment: { id: string; author: string },
) {
  const organizers = (await sessionCollaborators(sql, sessionId))
    .filter((member) => member.role !== "viewer")
    .map((member) => member.id);
  await notifyGrouped(sql, organizers, {
    kind: "visitor-comments",
    sessionId,
    targetId: comment.id,
    actor: comment.author,
  });
}

/** Every active administrator but the author. */
export async function notifyFeedback(
  sql: Sql,
  authorId: string,
  authorName: string,
) {
  const admins = await sql.all<{ id: string }>(
    "SELECT id FROM users WHERE is_admin=1 AND id<>$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
    [authorId],
  );
  await notifyGrouped(
    sql,
    admins.map((row) => row.id),
    { kind: "feedback", sessionId: null, targetId: null, actor: authorName },
  );
}
