import type { Express, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import type { Role, Session, User } from "../shared/model.js";
import type {
  Collaborator,
  CommentsResponse,
  CommentThread,
  TeamComment,
  TeamNotification,
} from "../shared/comments.js";
import { allBlocks } from "../shared/domain.js";
import { fail } from "./security.js";
import {
  richTextMentions,
  completedTaskMentionCounts,
} from "../shared/richtext.js";
import { accountProfile } from "./accounts.js";
import { sessionCollaborators } from "./collaborators.js";
import { guardSessionLifecycle } from "./lifecycle.js";
import { createAppNotifications } from "./app-notifications.js";

type Dependencies = {
  db: Database;
  authenticated: RequestHandler;
  accessible: (
    id: string,
    userId: string,
    allowed?: Role[],
  ) => Promise<{ session: Session; role: Role }>;
};
const id = z.string().min(1).max(120);
const actor = (response: Response) => response.locals.user as User;
const parameter = (request: Request, key: string) =>
  id.parse(request.params[key]);
const unavailable = () =>
  fail(404, "NOT_FOUND", "This conversation is unavailable.");
const schema = [
  "CREATE TABLE IF NOT EXISTS comment_threads (id TEXT PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, resolved_at TEXT, resolved_by TEXT REFERENCES users(id), revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS comment_context (comment_id TEXT PRIMARY KEY REFERENCES comments(id) ON DELETE CASCADE, thread_id TEXT NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE, parent_id TEXT REFERENCES comments(id), mention_ids TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS comment_threads_session_idx ON comment_threads(session_id,updated_at)",
  "CREATE INDEX IF NOT EXISTS comment_context_thread_idx ON comment_context(thread_id)",
  "CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, actor_id TEXT NOT NULL REFERENCES users(id), block_id TEXT, comment_id TEXT REFERENCES comments(id) ON DELETE CASCADE, kind TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT)",
  "CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications(user_id,created_at)",
];

async function notify(
  sql: Sql,
  sessionId: string,
  author: string,
  recipients: Map<string, TeamNotification["kind"]>,
  blockId: string | null,
  commentId: string | null,
  createdAt: string,
) {
  for (const [recipient, kind] of recipients) {
    if (recipient === author) continue;
    await sql.run(
      "INSERT INTO notifications(id,user_id,session_id,actor_id,block_id,comment_id,kind,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        randomUUID(),
        recipient,
        sessionId,
        author,
        blockId,
        commentId,
        kind,
        createdAt,
      ],
    );
    // A bounded inbox retains the latest 1000 notifications per account.
    await sql.run(
      "DELETE FROM notifications WHERE user_id=$1 AND id NOT IN (SELECT id FROM notifications WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1000)",
      [recipient],
    );
  }
}

/** Transactional side effect of a successful session CAS. Invalid/non-member
 * imported mentions remain text but never notify someone outside this session. */
export async function recordMentionNotifications(
  sql: Sql,
  before: Session,
  after: Session,
  author: string,
) {
  const previous = new Map(
    before.days
      .flatMap((day) => allBlocks(day.blocks))
      .map((block) => [block.id, block]),
  );
  let members: Set<string> | undefined;
  for (const block of after.days.flatMap((day) => allBlocks(day.blocks))) {
    const old = previous.get(block.id),
      nextValues = [block.description, ...Object.values(block.fields)],
      oldValues = old ? [old.description, ...Object.values(old.fields)] : [];
    if (JSON.stringify(nextValues) === JSON.stringify(oldValues)) continue;
    const priorMentions = new Set(oldValues.flatMap(richTextMentions));
    const taskCounts = (values: string[]) => {
      const result = new Map<string, number>();
      for (const value of values)
        for (const [recipient, count] of completedTaskMentionCounts(value))
          result.set(recipient, (result.get(recipient) ?? 0) + count);
      return result;
    };
    const priorCompleted = taskCounts(oldValues),
      nextCompleted = taskCounts(nextValues);
    const recipients = new Map<string, TeamNotification["kind"]>();
    for (const mention of nextValues.flatMap(richTextMentions))
      if (!priorMentions.has(mention)) recipients.set(mention, "block-mention");
    for (const [mention, count] of nextCompleted)
      if (count > (priorCompleted.get(mention) ?? 0))
        recipients.set(mention, "task-completed");
    if (!recipients.size) continue;
    members ??= new Set(
      (await sessionCollaborators(sql, after.id)).map((member) => member.id),
    );
    for (const recipient of recipients.keys())
      if (!members.has(recipient)) recipients.delete(recipient);
    await notify(
      sql,
      after.id,
      author,
      recipients,
      block.id,
      null,
      after.updatedAt,
    );
  }
}

type ThreadRow = {
  id: string;
  blockId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  revision: number;
  updatedAt: string;
};
type CommentRow = Omit<TeamComment, "mentions"> & { mentionIds: string };
async function conversation(
  sql: Sql,
  sessionId: string,
  threadId: string,
  members: Collaborator[],
  full = false,
): Promise<CommentThread | undefined> {
  const [thread] = await sql.all<ThreadRow>(
    'SELECT t.id,c.block_id AS "blockId",t.resolved_at AS "resolvedAt",t.resolved_by AS "resolvedBy",t.revision,t.updated_at AS "updatedAt" FROM comment_threads t JOIN comments c ON c.id=t.id WHERE t.session_id=$1 AND t.id=$2',
    [sessionId, threadId],
  );
  if (!thread) return;
  const [{ count }] = await sql.all<{ count: string | number }>(
    "SELECT COUNT(*) AS count FROM comment_context WHERE thread_id=$1",
    [threadId],
  );
  const rows = await sql.all<CommentRow>(
    'SELECT c.id,c.session_id AS "sessionId",c.block_id AS "blockId",c.user_id AS "authorId",u.name AS author,c.text,c.created_at AS "createdAt",x.thread_id AS "threadId",x.parent_id AS "parentId",x.mention_ids AS "mentionIds" FROM comments c JOIN comment_context x ON x.comment_id=c.id JOIN users u ON u.id=c.user_id WHERE c.session_id=$1 AND x.thread_id=$2 ORDER BY CASE WHEN c.id=$2 THEN 0 ELSE 1 END ASC,c.created_at DESC,c.id DESC LIMIT $3',
    [sessionId, threadId, full ? 501 : 16],
  );
  const comments = rows.map(({ mentionIds, ...comment }) => ({
    ...comment,
    mentions: members.filter((member) =>
      (JSON.parse(mentionIds) as string[]).includes(member.id),
    ),
  }));
  // The root always comes first, including two comments written in the same millisecond.
  comments.sort((a, b) =>
    a.id === thread.id
      ? -1
      : b.id === thread.id
        ? 1
        : a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return {
    ...thread,
    comments,
    totalComments: Number(count),
    hasMore: Number(count) > comments.length,
  };
}

export async function installCommentsApi(
  app: Express,
  { db, accessible, authenticated }: Dependencies,
) {
  for (const statement of schema) await db.run(statement);
  await createAppNotifications(db);
  // Add thread metadata to legacy comments without changing or deleting their content.
  await db.transaction(async (sql) => {
    await sql.run(
      "INSERT INTO comment_threads(id,session_id,updated_at) SELECT c.id,c.session_id,c.created_at FROM comments c LEFT JOIN comment_context x ON x.comment_id=c.id WHERE x.comment_id IS NULL ON CONFLICT(id) DO NOTHING",
    );
    await sql.run(
      "INSERT INTO comment_context(comment_id,thread_id,parent_id,mention_ids) SELECT c.id,c.id,NULL,'[]' FROM comments c LEFT JOIN comment_context x ON x.comment_id=c.id WHERE x.comment_id IS NULL ON CONFLICT(comment_id) DO NOTHING",
    );
  });
  app.get(
    "/api/sessions/:id/collaborators",
    authenticated,
    async (request, response) => {
      const { session } = await accessible(
        parameter(request, "id"),
        actor(response).id,
      );
      response.json({
        collaborators: await sessionCollaborators(db, session.id),
      });
    },
  );
  app.get(
    "/api/sessions/:id/comment-counts",
    authenticated,
    async (request, response) => {
      const { session } = await accessible(
        parameter(request, "id"),
        actor(response).id,
      );
      const rows = await db.all<{
        blockId: string | null;
        count: string | number;
      }>(
        'SELECT c.block_id AS "blockId",COUNT(*) AS count FROM comments c JOIN comment_context x ON x.comment_id=c.id JOIN comment_threads t ON t.id=x.thread_id WHERE c.session_id=$1 AND t.resolved_at IS NULL GROUP BY c.block_id',
        [session.id],
      );
      response.json({
        total: rows.reduce((count, row) => count + Number(row.count), 0),
        session: rows
          .filter((row) => row.blockId === null)
          .reduce((count, row) => count + Number(row.count), 0),
        blocks: Object.fromEntries(
          rows
            .filter((row) => row.blockId !== null)
            .map((row) => [row.blockId, Number(row.count)]),
        ),
      });
    },
  );
  app.get(
    "/api/sessions/:id/comments",
    authenticated,
    async (request, response) => {
      const query = z
        .object({
          offset: z.coerce.number().int().min(0).max(10000).default(0),
          status: z.enum(["open", "resolved", "all"]).default("all"),
          sort: z.enum(["updated", "agenda"]).default("updated"),
        })
        .parse(request.query);
      const { session } = await accessible(
          parameter(request, "id"),
          actor(response).id,
        ),
        members = await sessionCollaborators(db, session.id);
      const filter =
        query.status === "open"
          ? " AND t.resolved_at IS NULL"
          : query.status === "resolved"
            ? " AND t.resolved_at IS NOT NULL"
            : "";
      const rows = await db.all<{
        id: string;
        blockId: string | null;
        updatedAt: string;
      }>(
        `SELECT t.id,c.block_id AS "blockId",t.updated_at AS "updatedAt" FROM comment_threads t JOIN comments c ON c.id=t.id WHERE t.session_id=$1${filter} ORDER BY t.updated_at DESC,t.id DESC LIMIT 10001`,
        [session.id],
      );
      if (query.sort === "agenda") {
        const order = new Map(
          session.days
            .flatMap((day) => allBlocks(day.blocks))
            .map((block, index) => [block.id, index]),
        );
        rows.sort(
          (a, b) =>
            (a.blockId
              ? (order.get(a.blockId) ?? Number.MAX_SAFE_INTEGER)
              : -1) -
              (b.blockId
                ? (order.get(b.blockId) ?? Number.MAX_SAFE_INTEGER)
                : -1) ||
            b.updatedAt.localeCompare(a.updatedAt) ||
            b.id.localeCompare(a.id),
        );
      }
      const threads: CommentThread[] = [];
      for (const row of rows.slice(query.offset, query.offset + 20)) {
        const thread = await conversation(db, session.id, row.id, members);
        if (thread) threads.push(thread);
      }
      const result: CommentsResponse = {
        threads,
        comments: threads.flatMap((thread) => thread.comments),
        total: rows.length,
        hasMore: query.offset + 20 < rows.length,
      };
      response.json(result);
    },
  );
  app.post(
    "/api/sessions/:id/comments",
    authenticated,
    async (request, response) => {
      const input = z
        .object({
          blockId: id.nullable().default(null),
          text: z.string().trim().min(1).max(4000),
          parentId: id.optional(),
          mentions: z.array(id).max(50).default([]),
        })
        .strict()
        .parse(request.body);
      const user = actor(response),
        { session } = await accessible(parameter(request, "id"), user.id);
      if (
        input.blockId &&
        !session.days.some((day) =>
          allBlocks(day.blocks).some((block) => block.id === input.blockId),
        )
      )
        fail(400, "INVALID_BLOCK", "This block does not exist.");
      const thread = await db.transaction(async (sql) => {
        await sql.run("UPDATE sessions SET version=version WHERE id=$1", [
          session.id,
        ]);
        await guardSessionLifecycle(sql, session.id, { write: true });
        const members = await sessionCollaborators(sql, session.id);
        if (!members.some((member) => member.id === user.id)) unavailable();
        const mentioned = [...new Set(input.mentions)];
        if (
          mentioned.some(
            (mention) => !members.some((member) => member.id === mention),
          )
        )
          fail(
            400,
            "INVALID_MENTION",
            "Only current collaborators can be mentioned.",
          );
        let threadId: string | undefined,
          blockId = input.blockId;
        if (input.parentId) {
          const [parent] = await sql.all<{
            threadId: string;
            blockId: string | null;
          }>(
            'SELECT x.thread_id AS "threadId",c.block_id AS "blockId" FROM comments c JOIN comment_context x ON x.comment_id=c.id WHERE c.id=$1 AND c.session_id=$2',
            [input.parentId, session.id],
          );
          if (!parent) unavailable();
          threadId = parent.threadId;
          blockId = parent.blockId;
          if (input.blockId && input.blockId !== blockId)
            fail(
              400,
              "INVALID_BLOCK",
              "Replies belong to their original block.",
            );
          const [{ count }] = await sql.all<{ count: number | string }>(
            "SELECT COUNT(*) AS count FROM comment_context WHERE thread_id=$1",
            [threadId],
          );
          if (Number(count) >= 500)
            fail(
              400,
              "COMMENT_LIMIT",
              "Start a new thread; this thread has reached its reply limit.",
            );
        } else {
          const [{ count }] = await sql.all<{ count: number | string }>(
            "SELECT COUNT(*) AS count FROM comment_threads WHERE session_id=$1",
            [session.id],
          );
          if (Number(count) >= 10000)
            fail(
              400,
              "COMMENT_LIMIT",
              "This agenda has reached its thread limit.",
            );
        }
        const commentId = randomUUID(),
          now = new Date().toISOString();
        if (threadId) {
          const updated = await sql.run(
            "UPDATE comment_threads SET revision=revision+1,updated_at=$1 WHERE id=$2 AND session_id=$3 AND resolved_at IS NULL",
            [now, threadId, session.id],
          );
          if (!updated)
            fail(409, "THREAD_RESOLVED", "Reopen the thread before replying.");
        }
        await sql.run(
          "INSERT INTO comments(id,session_id,block_id,user_id,text,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [commentId, session.id, blockId, user.id, input.text, now],
        );
        if (!threadId) {
          threadId = commentId;
          await sql.run(
            "INSERT INTO comment_threads(id,session_id,updated_at) VALUES($1,$2,$3)",
            [threadId, session.id, now],
          );
        }
        await sql.run(
          "INSERT INTO comment_context(comment_id,thread_id,parent_id,mention_ids) VALUES($1,$2,$3,$4)",
          [
            commentId,
            threadId,
            input.parentId ?? null,
            JSON.stringify(mentioned),
          ],
        );
        const recipients = new Map(
          members.map(
            (member) =>
              [
                member.id,
                mentioned.includes(member.id)
                  ? "mention"
                  : input.parentId
                    ? "reply"
                    : "comment",
              ] as [string, TeamNotification["kind"]],
          ),
        );
        await notify(
          sql,
          session.id,
          user.id,
          recipients,
          blockId,
          commentId,
          now,
        );
        return {
          thread: (await conversation(sql, session.id, threadId, members))!,
          commentId,
        };
      });
      response.status(201).json({
        thread: thread.thread,
        comment: thread.thread.comments.find(
          (comment) => comment.id === thread.commentId,
        ),
      });
    },
  );
  app.get(
    "/api/sessions/:id/comments/:commentId",
    authenticated,
    async (request, response) => {
      const { session } = await accessible(
        parameter(request, "id"),
        actor(response).id,
      );
      const [context] = await db.all<{ threadId: string }>(
        'SELECT x.thread_id AS "threadId" FROM comment_context x JOIN comments c ON c.id=x.comment_id WHERE c.id=$1 AND c.session_id=$2',
        [parameter(request, "commentId"), session.id],
      );
      if (!context) unavailable();
      response.json({
        thread: await conversation(
          db,
          session.id,
          context.threadId,
          await sessionCollaborators(db, session.id),
          true,
        ),
      });
    },
  );
  app.patch(
    "/api/sessions/:id/comments/:threadId",
    authenticated,
    async (request, response) => {
      const input = z
          .object({
            resolved: z.boolean(),
            revision: z.number().int().nonnegative(),
          })
          .strict()
          .parse(request.body),
        user = actor(response);
      const { session } = await accessible(parameter(request, "id"), user.id),
        threadId = parameter(request, "threadId");
      const updated = await db.transaction(async (sql) => {
        await sql.run("UPDATE sessions SET version=version WHERE id=$1", [
          session.id,
        ]);
        await guardSessionLifecycle(sql, session.id, { write: true });
        return sql.run(
          "UPDATE comment_threads SET resolved_at=$1,resolved_by=$2,revision=revision+1,updated_at=$3 WHERE id=$4 AND session_id=$5 AND revision=$6",
          [
            input.resolved ? new Date().toISOString() : null,
            input.resolved ? user.id : null,
            new Date().toISOString(),
            threadId,
            session.id,
            input.revision,
          ],
        );
      });
      if (!updated) {
        const [exists] = await db.all(
          "SELECT id FROM comment_threads WHERE id=$1 AND session_id=$2",
          [threadId, session.id],
        );
        if (!exists) unavailable();
        fail(
          409,
          "THREAD_CONFLICT",
          "This thread changed. Reload before resolving it.",
        );
      }
      response.json({
        thread: await conversation(
          db,
          session.id,
          threadId,
          await sessionCollaborators(db, session.id),
        ),
      });
    },
  );
  app.get("/api/notifications", authenticated, async (_request, response) => {
    const user = actor(response);
    const profile = await accountProfile(db, user.id),
      filter = profile.preferences.inAppMentions
        ? ""
        : " AND n.kind NOT IN ('mention','block-mention','task-completed')";
    const scope = `FROM notifications n JOIN users u ON u.id=n.actor_id JOIN sessions s ON s.id=n.session_id LEFT JOIN members m ON m.session_id=s.id AND m.user_id=$1 LEFT JOIN session_workspaces sw ON sw.session_id=s.id LEFT JOIN workspace_members wm ON wm.workspace_id=sw.workspace_id AND wm.user_id=$1 WHERE n.user_id=$1 AND NOT EXISTS(SELECT 1 FROM session_lifecycle l WHERE l.session_id=s.id AND l.deleted_at IS NOT NULL) AND (s.owner_id=$1 OR m.user_id=$1 OR wm.user_id=$1)${filter}`;
    const rows = await db.all<Omit<TeamNotification, "sessionTitle">>(
      `SELECT n.id,n.session_id AS "sessionId",n.block_id AS "blockId",n.comment_id AS "commentId",n.kind,n.created_at AS "createdAt",n.read_at AS "readAt",u.name AS actor ${scope} ORDER BY n.created_at DESC,n.id DESC LIMIT 100`,
      [user.id],
    );
    const [{ count }] = await db.all<{ count: string | number }>(
      `SELECT COUNT(*) AS count ${scope} AND n.read_at IS NULL`,
      [user.id],
    );
    // Visitor comments and problem reports, grouped (app-notifications.ts):
    // shown only while the account still has the access they concern.
    const groupedScope = `FROM app_notifications n LEFT JOIN sessions s ON s.id=n.session_id LEFT JOIN members m ON m.session_id=s.id AND m.user_id=$1 LEFT JOIN session_workspaces sw ON sw.session_id=s.id LEFT JOIN workspace_members wm ON wm.workspace_id=sw.workspace_id AND wm.user_id=$1 WHERE n.user_id=$1 AND (n.session_id IS NULL AND n.kind='feedback' AND EXISTS(SELECT 1 FROM users a WHERE a.id=$1 AND a.is_admin=1) OR n.session_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM session_lifecycle l WHERE l.session_id=s.id AND l.deleted_at IS NOT NULL) AND (s.owner_id=$1 OR m.user_id=$1 OR wm.user_id=$1))`;
    const grouped = await db.all<Omit<TeamNotification, "sessionTitle">>(
      `SELECT DISTINCT n.id,n.session_id AS "sessionId",NULL AS "blockId",n.target_id AS "commentId",n.kind,n.count,n.updated_at AS "createdAt",n.read_at AS "readAt",n.actor ${groupedScope} ORDER BY n.updated_at DESC LIMIT 50`,
      [user.id],
    );
    const [{ count: groupedUnread }] = await db.all<{
      count: string | number;
    }>(
      `SELECT COUNT(DISTINCT n.id) AS count ${groupedScope} AND n.read_at IS NULL`,
      [user.id],
    );
    // Read a potentially large agenda payload only once per distinct session,
    // rather than duplicating it on every notification row.
    const titles = new Map<string, string>();
    const all = [...rows, ...grouped]
      .map((row) => ({
        ...row,
        count: row.count ? Number(row.count) : undefined,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 100);
    for (const sessionId of new Set(
      all.map((row) => row.sessionId).filter((id): id is string => !!id),
    )) {
      const [row] = await db.all<{ payload: string }>(
        "SELECT payload FROM sessions WHERE id=$1",
        [sessionId],
      );
      if (row)
        titles.set(sessionId, (JSON.parse(row.payload) as Session).title);
    }
    response.json({
      notifications: all.map((notification) => ({
        ...notification,
        sessionTitle: notification.sessionId
          ? (titles.get(notification.sessionId) ?? "")
          : "",
      })),
      unread: Number(count) + Number(groupedUnread),
    });
  });
  app.post(
    "/api/notifications/read",
    authenticated,
    async (request, response) => {
      const input = z
          .object({
            ids: z.array(id).max(100).optional(),
            all: z.boolean().optional(),
          })
          .strict()
          .refine((value) => value.all === true || !!value.ids?.length)
          .parse(request.body),
        user = actor(response),
        now = new Date().toISOString();
      for (const table of ["notifications", "app_notifications"])
        if (input.all)
          await db.run(
            `UPDATE ${table} SET read_at=$1 WHERE user_id=$2 AND read_at IS NULL`,
            [now, user.id],
          );
        else
          for (const notificationId of input.ids!)
            await db.run(
              `UPDATE ${table} SET read_at=$1 WHERE user_id=$2 AND id=$3 AND read_at IS NULL`,
              [now, user.id, notificationId],
            );
      response.json({ ok: true });
    },
  );
}
