import type { Express, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { User } from "../shared/model.js";
import type { Database } from "./db.js";
import { rateLimit } from "./security.js";
import type { AppVersion } from "./version.js";

/** Where administrators forward a report, from their own browser. */
export const DEFAULT_ISSUES_URL =
  "https://github.com/republique-et-canton-de-geneve/MeetLoom/issues/new";
export const FEEDBACK_STATUSES = [
  "new",
  "in-progress",
  "done",
  "dismissed",
] as const;

/**
 * Problems and ideas reported from the application by anyone signed in, so
 * nobody needs a GitHub account and the server never needs to reach GitHub.
 * Administrators triage them and may open a prefilled GitHub issue from
 * their own browser, where they review it before submitting.
 */
export async function registerFeedback(
  app: Express,
  {
    db,
    authenticated,
    admin,
    version,
    issuesUrl,
    rateLimits,
  }: {
    db: Database;
    authenticated: RequestHandler;
    admin: RequestHandler;
    version: AppVersion;
    /** Null hides the GitHub link. */
    issuesUrl: string | null;
    rateLimits?: boolean;
  },
) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS feedback (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, page TEXT, app_version TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS feedback_created_idx ON feedback(created_at)",
  );
  const who = (response: Response) => response.locals.user as User;
  const limiter: RequestHandler =
    rateLimits === false
      ? (_request, _response, next) => next()
      : rateLimit(10, 60 * 60_000, (_request, response) => who(response).id);
  const columns =
    'f.id,f.kind,f.message,f.page,f.app_version AS "appVersion",f.status,f.created_at AS "createdAt",f.updated_at AS "updatedAt"';

  app.post(
    "/api/feedback",
    authenticated,
    limiter,
    async (request, response) => {
      const input = z
        .object({
          kind: z.enum(["bug", "idea", "other"]),
          message: z.string().trim().min(1).max(4000),
          page: z.string().trim().max(300).optional(),
        })
        .strict()
        .parse(request.body);
      const now = new Date().toISOString();
      const item = {
        id: randomUUID(),
        kind: input.kind,
        message: input.message,
        // The path only: a query could carry a token.
        page: input.page?.split(/[?#]/)[0] || null,
        appVersion: version.version,
        status: "new" as const,
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        "INSERT INTO feedback(id,user_id,kind,message,page,app_version,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          item.id,
          who(response).id,
          item.kind,
          item.message,
          item.page,
          item.appVersion,
          item.status,
          item.createdAt,
          item.updatedAt,
        ],
      );
      response.status(201).json({ feedback: item });
    },
  );
  app.get("/api/feedback/mine", authenticated, async (_request, response) => {
    response.json({
      feedback: await db.all(
        `SELECT ${columns} FROM feedback f WHERE f.user_id=$1 ORDER BY f.created_at DESC LIMIT 100`,
        [who(response).id],
      ),
    });
  });
  app.get("/api/admin/feedback", admin, async (_request, response) => {
    const rows = await db.all<{
      authorName: string | null;
      authorEmail: string | null;
    }>(
      `SELECT ${columns},u.name AS "authorName",u.email AS "authorEmail" FROM feedback f LEFT JOIN users u ON u.id=f.user_id ORDER BY f.created_at DESC LIMIT 500`,
    );
    response.json({
      issuesUrl,
      feedback: rows.map(({ authorName, authorEmail, ...row }) => ({
        ...row,
        author: authorName ? { name: authorName, email: authorEmail } : null,
      })),
    });
  });
  app.patch("/api/admin/feedback/:id", admin, async (request, response) => {
    const { status } = z
      .object({ status: z.enum(FEEDBACK_STATUSES) })
      .strict()
      .parse(request.body);
    const changed = await db.run(
      "UPDATE feedback SET status=$1,updated_at=$2 WHERE id=$3",
      [
        status,
        new Date().toISOString(),
        z.string().max(120).parse(request.params.id),
      ],
    );
    if (!changed)
      return void response
        .status(404)
        .json({ error: "This report does not exist.", code: "NOT_FOUND" });
    response.json({ ok: true });
  });
}
