import type { Express, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Role, Session, User } from "../shared/model.js";
import { allBlocks } from "../shared/domain.js";
import { orderedContent } from "../shared/content.js";
import {
  sharedAgenda,
  sharingSchema,
  type SharingOptions,
} from "../shared/sharing.js";
import type { Database, Sql } from "./db.js";
import { guardSessionLifecycle } from "./lifecycle.js";
import { accessibleSessionRows, mappedSession } from "./workspaces.js";
import { fail, hashToken, rateLimit, token } from "./security.js";
import type { PublicQuotas } from "./quotas.js";

interface Dependencies {
  db: Database;
  accessible: (
    id: string,
    userId: string,
    roles?: Role[],
  ) => Promise<{ session: Session; role: Role }>;
  synchronized: (session: Session) => Promise<Session>;
  rateLimits?: boolean;
  quotas: PublicQuotas;
}
const id = z.string().min(1).max(120),
  rawToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const who = (res: Response) => res.locals.user as User;
const commentInput = z.object({
  author: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(4000),
  blockId: id.nullable().default(null),
  parentId: id.nullable().default(null),
});
export async function registerSharing(
  app: Express,
  { db, accessible, synchronized, rateLimits, quotas }: Dependencies,
) {
  await db.transaction(async (sql) => {
    await sql.run(
      "CREATE TABLE IF NOT EXISTS share_options (share_id TEXT PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE, payload TEXT NOT NULL)",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS visitor_comments (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, share_id TEXT NOT NULL, block_id TEXT, author TEXT NOT NULL, text TEXT NOT NULL, parent_id TEXT, resolved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
    );
    await sql.run(
      "CREATE INDEX IF NOT EXISTS visitor_comments_share_idx ON visitor_comments(share_id,created_at)",
    );
  });
  const lockAccess = async (
    sql: Sql,
    sessionId: string,
    userId: string,
    roles?: Role[],
    write = false,
  ) => {
    await sql.run("UPDATE sessions SET version=version WHERE id=$1", [
      sessionId,
    ]);
    const [disabled] = await sql.all(
      "SELECT user_id FROM account_disabled WHERE user_id=$1",
      [userId],
    );
    if (disabled) return fail(401, "UNAUTHORIZED", "Sign in again.");
    const [row] = await accessibleSessionRows(sql, userId, sessionId);
    if (!row) return fail(404, "NOT_FOUND", "Session not found.");
    if (roles && !roles.includes(row.role))
      return fail(
        403,
        "FORBIDDEN",
        "Your current role does not allow this action.",
      );
    await guardSessionLifecycle(sql, sessionId, { write });
    return mappedSession(row);
  };
  const resolve = async (raw: unknown, sql: Sql = db) => {
    const [row] = await sql.all<{
      id: string;
      session_id: string;
      payload: string;
      options: string | null;
    }>(
      "SELECT l.id,l.session_id,s.payload,o.payload AS options FROM shares l JOIN sessions s ON s.id=l.session_id LEFT JOIN share_options o ON o.share_id=l.id WHERE l.token_hash=$1 AND (l.expires_at IS NULL OR l.expires_at>$2)",
      [hashToken(rawToken.parse(raw)), new Date().toISOString()],
    );
    if (!row) return fail(404, "NOT_FOUND", "This link is not available.");
    const lifecycle = await guardSessionLifecycle(sql, row.session_id);
    const options = sharingSchema.parse(
      row.options ? JSON.parse(row.options) : {},
    );
    if (!options.enabled)
      return fail(404, "NOT_FOUND", "This link is not available.");
    const session = JSON.parse(row.payload) as Session;
    let projection: ReturnType<typeof sharedAgenda> | undefined;
    return {
      ...row,
      options,
      closed: !!lifecycle?.closed_at,
      session,
      // Computed on demand: the visitor page projects the synchronized
      // session itself, so projecting here too would double its cost.
      get projection() {
        return (projection ??= sharedAgenda(session, options));
      },
    };
  };
  const comments = async (shareId: string, blockIds: Set<string>) => {
    const rows = await db.all<{
      id: string;
      blockId: string | null;
      author: string;
      text: string;
      createdAt: string;
      parentId: string | null;
      resolved: number;
    }>(
      'SELECT id,block_id AS "blockId",author,text,created_at AS "createdAt",parent_id AS "parentId",resolved FROM visitor_comments WHERE share_id=$1 ORDER BY created_at DESC,id DESC LIMIT 500',
      [shareId],
    );
    return rows
      .filter((row) => !row.blockId || blockIds.has(row.blockId))
      .reverse()
      .map((row) => ({ ...row, resolved: !!row.resolved }));
  };
  const validateNonempty = async (
    session: Session,
    options: SharingOptions,
    sql: Sql = db,
  ) => {
    if (
      session.days.some(
        (day) => !options.dayIds || options.dayIds.includes(day.id),
      )
    )
      return;
    if (options.mode === "visitor") {
      if (
        session.pages?.some(
          (page) =>
            page.visibility === "public" &&
            (!options.pageIds || options.pageIds.includes(page.id)),
        )
      )
        return;
      const published = await sql.all<{ form_id: string }>(
        "SELECT form_id FROM form_publications WHERE session_id=$1 AND enabled=1",
        [session.id],
      );
      if (
        published.some(
          (row) =>
            options.formIds.includes(row.form_id) &&
            session.forms?.some((form) => form.id === row.form_id),
        )
      )
        return;
    }
    return fail(
      400,
      "EMPTY_SHARE",
      "Choose at least one day, public page, or published form.",
    );
  };
  app.get("/api/sessions/:id/shares", async (req, res) => {
    const { session } = await accessible(id.parse(req.params.id), who(res).id, [
      "owner",
    ]);
    const rows = await db.all<{
      id: string;
      label: string;
      expiresAt: string | null;
      createdAt: string;
      options: string | null;
    }>(
      'SELECT l.id,l.label,l.expires_at AS "expiresAt",l.created_at AS "createdAt",o.payload AS options FROM shares l LEFT JOIN share_options o ON o.share_id=l.id WHERE l.session_id=$1 ORDER BY l.created_at DESC',
      [session.id],
    );
    res.json({
      shares: rows.map(({ options, ...row }) => ({
        ...row,
        ...sharingSchema.parse(options ? JSON.parse(options) : {}),
      })),
    });
  });
  app.post("/api/sessions/:id/shares", async (req, res) => {
    const input = z
      .object({
        label: z.string().trim().min(1).max(120),
        expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
        ...sharingSchema.shape,
      })
      .parse(req.body);
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now())
      return fail(400, "INVALID_EXPIRY", "Choose a future expiration date.");
    const { session } = await accessible(id.parse(req.params.id), who(res).id, [
      "owner",
    ]);
    if (
      input.dayIds?.some(
        (dayId) => !session.days.some((day) => day.id === dayId),
      )
    )
      return fail(400, "INVALID_DAY", "This day does not exist.");
    if (
      input.initialDayId &&
      !session.days.some(
        (day) =>
          day.id === input.initialDayId &&
          (!input.dayIds || input.dayIds.includes(day.id)),
      )
    )
      return fail(400, "INVALID_DAY", "The initial day must be shared.");
    if (
      input.pageIds?.some(
        (pageId) =>
          !session.pages?.some(
            (page) => page.id === pageId && page.visibility === "public",
          ),
      )
    )
      return fail(400, "INVALID_PAGE", "Only public pages may be shared.");
    const options: SharingOptions = {
      enabled: input.enabled,
      mode: input.mode,
      dayIds: input.dayIds,
      pageIds: input.pageIds,
      formIds: input.mode === "visitor" ? input.formIds : [],
      initialContentId: input.initialContentId,
      initialDayId: input.initialDayId,
      allowComments: input.mode === "visitor" && input.allowComments,
    };
    if (
      options.formIds.some(
        (formId) => !session.forms?.some((form) => form.id === formId),
      )
    )
      return fail(400, "INVALID_FORM", "This form does not exist.");
    await validateNonempty(session, options);
    const raw = token(),
      share = {
        id: randomUUID(),
        label: input.label,
        expiresAt: input.expiresAt
          ? new Date(input.expiresAt).toISOString()
          : null,
        createdAt: new Date().toISOString(),
        token: raw,
        ...options,
      };
    await db.transaction(async (sql) => {
      await lockAccess(sql, session.id, who(res).id, ["owner"]);
      await sql.run(
        "INSERT INTO shares(id,session_id,label,token_hash,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          share.id,
          session.id,
          share.label,
          hashToken(raw),
          share.expiresAt,
          share.createdAt,
        ],
      );
      await sql.run(
        "INSERT INTO share_options(share_id,payload) VALUES($1,$2)",
        [share.id, JSON.stringify(options)],
      );
    });
    res.status(201).json({ share });
  });
  app.delete("/api/sessions/:id/shares/:shareId", async (req, res) => {
    const { session } = await accessible(id.parse(req.params.id), who(res).id, [
      "owner",
    ]);
    await db.transaction(async (sql) => {
      await lockAccess(sql, session.id, who(res).id, ["owner"]);
      if (
        !(await sql.run("DELETE FROM shares WHERE id=$1 AND session_id=$2", [
          id.parse(req.params.shareId),
          session.id,
        ]))
      )
        return fail(404, "NOT_FOUND", "This link does not exist.");
    });
    res.json({ ok: true });
  });
  app.patch("/api/sessions/:id/shares/:shareId", async (req, res) => {
    const { session } = await accessible(id.parse(req.params.id), who(res).id, [
      "owner",
    ]);
    await db.transaction(async (sql) => {
      await lockAccess(sql, session.id, who(res).id, ["owner"]);
      const [row] = await sql.all<{
        id: string;
        label: string;
        expiresAt: string | null;
        options: string | null;
      }>(
        'SELECT l.id,l.label,l.expires_at AS "expiresAt",o.payload AS options FROM shares l LEFT JOIN share_options o ON o.share_id=l.id WHERE l.id=$1 AND l.session_id=$2',
        [id.parse(req.params.shareId), session.id],
      );
      if (!row) return fail(404, "NOT_FOUND", "This link does not exist.");
      const parsed = z
        .object({
          label: z.string().trim().min(1).max(120),
          expiresAt: z.iso.datetime({ offset: true }).nullable(),
          ...sharingSchema.partial().shape,
        })
        .partial()
        .strict()
        .parse(req.body);
      // Zod applies nested defaults even through optional properties. A PATCH must
      // retain every option absent from the request, including comments and layout.
      const changes = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => Object.hasOwn(req.body, key)),
      ) as typeof parsed;
      const { label, expiresAt, ...scope } = changes;
      const options = sharingSchema.parse({
        ...sharingSchema.parse(row.options ? JSON.parse(row.options) : {}),
        ...scope,
      });
      await validateNonempty(session, options, sql);
      if (
        options.formIds.some(
          (formId) => !session.forms?.some((form) => form.id === formId),
        )
      )
        return fail(400, "INVALID_FORM", "This form does not exist.");
      if (
        options.dayIds?.some(
          (dayId) => !session.days.some((day) => day.id === dayId),
        ) ||
        (options.initialDayId &&
          !session.days.some(
            (day) =>
              day.id === options.initialDayId &&
              (!options.dayIds || options.dayIds.includes(day.id)),
          ))
      )
        return fail(400, "INVALID_DAY", "The initial day must be shared.");
      if (
        options.pageIds?.some(
          (pageId) =>
            !session.pages?.some(
              (page) => page.id === pageId && page.visibility === "public",
            ),
        )
      )
        return fail(400, "INVALID_PAGE", "Only public pages may be shared.");
      if (expiresAt && Date.parse(expiresAt) <= Date.now())
        return fail(400, "INVALID_EXPIRY", "Choose a future expiration date.");
      if (options.mode === "agenda") options.allowComments = false;
      await sql.run(
        "UPDATE shares SET label=$1,expires_at=$2 WHERE id=$3 AND session_id=$4",
        [
          label ?? row.label,
          expiresAt === undefined ? row.expiresAt : expiresAt,
          row.id,
          session.id,
        ],
      );
      await sql.run(
        "INSERT INTO share_options(share_id,payload) VALUES($1,$2) ON CONFLICT(share_id) DO UPDATE SET payload=excluded.payload",
        [row.id, JSON.stringify(options)],
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/public/:token", async (req, res) => {
    const link = await resolve(req.params.token);
    const projected = sharedAgenda(
      await synchronized(link.session),
      link.options,
    );
    const forms =
      link.options.mode === "visitor" && !link.closed && !link.session.archived
        ? (
            await db.all<{ form_id: string; definition: string }>(
              "SELECT form_id,definition FROM form_publications WHERE session_id=$1 AND enabled=1",
              [link.session_id],
            )
          )
            .filter(
              (row) =>
                link.options.formIds.includes(row.form_id) &&
                link.session.forms?.some((form) => form.id === row.form_id),
            )
            .map((row) => ({
              id: row.form_id,
              title: String(JSON.parse(row.definition).title),
            }))
        : [];
    const navigation = orderedContent(link.session).flatMap((item) => {
      const target =
        item.kind === "day"
          ? projected.days.find((day) => day.id === item.id)
          : item.kind === "page"
            ? projected.pages?.find((page) => page.id === item.id)
            : forms.find((form) => form.id === item.id);
      return target ? [{ ...item, title: target.title }] : [];
    });
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.json({
      session: projected,
      sharing: {
        mode: link.options.mode,
        allowComments: link.options.allowComments,
        readOnly: link.closed,
        initialDayId: link.options.initialDayId,
        initialContentId: link.options.initialContentId,
        navigation,
      },
    });
  });
  app.get("/api/public/:token/comments", async (req, res) => {
    const link = await resolve(req.params.token);
    if (!link.options.allowComments || link.options.mode !== "visitor")
      return fail(
        403,
        "COMMENTS_DISABLED",
        "Comments are disabled for this link.",
      );
    res.json({
      comments: await comments(
        link.id,
        new Set(
          link.projection.days.flatMap((day) =>
            allBlocks(day.blocks).map((block) => block.id),
          ),
        ),
      ),
    });
  });
  app.post(
    "/api/public/:token/comments",
    ...(rateLimits === false ? [] : [rateLimit(20, 60000)]),
    async (req: Request, res: Response) => {
      const comment = await db.transaction(async (sql) => {
        const initial = await resolve(req.params.token, sql);
        await sql.run("UPDATE sessions SET version=version WHERE id=$1", [
          initial.session_id,
        ]);
        await guardSessionLifecycle(sql, initial.session_id, { write: true });
        const link = await resolve(req.params.token, sql);
        if (!link.options.allowComments || link.options.mode !== "visitor")
          return fail(
            403,
            "COMMENTS_DISABLED",
            "Comments are disabled for this link.",
          );
        const input = commentInput.parse(req.body),
          blocks = new Set(
            link.projection.days.flatMap((day) =>
              allBlocks(day.blocks).map((block) => block.id),
            ),
          );
        if (input.blockId && !blocks.has(input.blockId))
          return fail(400, "INVALID_BLOCK", "This block is not shared.");
        if (input.parentId) {
          const [parent] = await sql.all<{ block_id: string | null }>(
            "SELECT block_id FROM visitor_comments WHERE id=$1 AND share_id=$2 AND parent_id IS NULL",
            [input.parentId, link.id],
          );
          if (!parent || (parent.block_id && !blocks.has(parent.block_id)))
            return fail(
              400,
              "INVALID_COMMENT",
              "This discussion is not available.",
            );
          input.blockId = parent.block_id;
        }
        // The session row is locked above (version touch), so parallel posts
        // cannot race past the quota.
        const [stored] = await sql.all<{ count: number | string }>(
          "SELECT COUNT(*) AS count FROM visitor_comments WHERE share_id=$1",
          [link.id],
        );
        if (Number(stored.count) >= quotas.visitorComments)
          return fail(
            409,
            "VISITOR_COMMENT_LIMIT",
            "This link has reached its comment limit.",
          );
        const comment = {
          id: randomUUID(),
          ...input,
          createdAt: new Date().toISOString(),
          resolved: false,
        };
        await sql.run(
          "INSERT INTO visitor_comments(id,session_id,share_id,block_id,author,text,parent_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            comment.id,
            link.session_id,
            link.id,
            comment.blockId,
            comment.author,
            comment.text,
            comment.parentId,
            comment.createdAt,
          ],
        );
        return comment;
      });
      res.status(201).json({ comment });
    },
  );
  app.get("/api/sessions/:id/visitor-comments", async (req, res) => {
    const { session } = await accessible(id.parse(req.params.id), who(res).id);
    const rows = await db.all<{ resolved: number }>(
      'SELECT id,block_id AS "blockId",author,text,created_at AS "createdAt",parent_id AS "parentId",resolved FROM visitor_comments WHERE session_id=$1 ORDER BY created_at DESC LIMIT 500',
      [session.id],
    );
    res.json({
      comments: rows
        .reverse()
        .map((row) => ({ ...row, resolved: !!row.resolved })),
    });
  });
  app.patch(
    "/api/sessions/:id/visitor-comments/:commentId",
    async (req, res) => {
      const { session } = await accessible(
        id.parse(req.params.id),
        who(res).id,
        ["owner", "editor", "facilitator"],
      );
      const input = z.object({ resolved: z.boolean() }).parse(req.body);
      await db.transaction(async (sql) => {
        await lockAccess(
          sql,
          session.id,
          who(res).id,
          ["owner", "editor", "facilitator"],
          true,
        );
        if (
          !(await sql.run(
            "UPDATE visitor_comments SET resolved=$1 WHERE id=$2 AND session_id=$3 AND parent_id IS NULL",
            [
              input.resolved ? 1 : 0,
              id.parse(req.params.commentId),
              session.id,
            ],
          ))
        )
          return fail(404, "NOT_FOUND", "Discussion not found.");
      });
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/sessions/:id/visitor-comments/:commentId/replies",
    async (req, res) => {
      const { session } = await accessible(
        id.parse(req.params.id),
        who(res).id,
      );
      const input = z
        .object({ text: z.string().trim().min(1).max(4000) })
        .parse(req.body);
      const comment = await db.transaction(async (sql) => {
        await lockAccess(sql, session.id, who(res).id, undefined, true);
        const [parent] = await sql.all<{
          id: string;
          block_id: string | null;
          share_id: string;
        }>(
          "SELECT id,block_id,share_id FROM visitor_comments WHERE id=$1 AND session_id=$2 AND parent_id IS NULL",
          [id.parse(req.params.commentId), session.id],
        );
        if (!parent) return fail(404, "NOT_FOUND", "Discussion not found.");
        const comment = {
          id: randomUUID(),
          blockId: parent.block_id,
          author: who(res).name,
          text: input.text,
          parentId: parent.id,
          createdAt: new Date().toISOString(),
          resolved: false,
        };
        await sql.run(
          "INSERT INTO visitor_comments(id,session_id,share_id,block_id,author,text,parent_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            comment.id,
            session.id,
            parent.share_id,
            comment.blockId,
            comment.author,
            comment.text,
            comment.parentId,
            comment.createdAt,
          ],
        );
        return comment;
      });
      res.status(201).json({ comment });
    },
  );
}
