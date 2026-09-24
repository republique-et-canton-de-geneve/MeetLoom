import type { Express, Request, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  formSchema,
  validateFormAnswers,
  type FormPublication,
  type FormResponse,
  type SessionForm,
} from "../shared/content.js";
import type { Role, Session, User } from "../shared/model.js";
import type { Database, Sql } from "./db.js";
import { fail, hashToken, rateLimit, token } from "./security.js";
import type { PublicQuotas } from "./quotas.js";
import { guardSessionLifecycle } from "./lifecycle.js";
import { sharingSchema } from "../shared/sharing.js";
import { parseFormImage } from "../shared/form-images.js";

type PublicationRow = {
  id: string;
  session_id: string;
  form_id: string;
  token_hash: string;
  enabled: number;
  definition: string;
  revision: number;
  created_at: string;
  updated_at: string;
};
type ResponseRow = {
  id: string;
  form_id: string;
  revision: number;
  definition: string;
  answers: string;
  respondent_id: string | null;
  respondent_name: string | null;
  respondent_email: string | null;
  created_at: string;
  submission_id: string;
};
type Options = {
  db: Database;
  accessible: (
    id: string,
    userId: string,
    allowed?: Role[],
  ) => Promise<{ session: Session; role: Role }>;
  authenticated: RequestHandler;
  rateLimits?: boolean;
  quotas: PublicQuotas;
};
const identifier = z.string().min(1).max(120);
const expected = z.object({ version: z.number().int().nonnegative() }).strict();
const who = (response: Response) => response.locals.user as User | undefined;
const parameter = (request: Request, key: string) =>
  identifier.parse(request.params[key]);
const missing = () => fail(404, "NOT_FOUND", "This form is unavailable.");
const metadata = (row: PublicationRow): FormPublication => ({
  id: row.id,
  formId: row.form_id,
  enabled: !!row.enabled,
  revision: row.revision,
  updatedAt: row.updated_at,
});
const responseValue = (row: ResponseRow): FormResponse => ({
  id: row.id,
  formId: row.form_id,
  revision: row.revision,
  definition: formSchema.parse(JSON.parse(row.definition)),
  answers: JSON.parse(row.answers),
  respondent: row.respondent_id
    ? {
        id: row.respondent_id,
        name: row.respondent_name ?? "",
        email: row.respondent_email ?? "",
      }
    : null,
  createdAt: row.created_at,
});

export async function installContentApi(
  app: Express,
  { db, accessible, authenticated, rateLimits, quotas }: Options,
): Promise<void> {
  await db.transaction(async (sql) => {
    await sql.run(
      "CREATE TABLE IF NOT EXISTS form_publications (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, form_id TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, enabled INTEGER NOT NULL, definition TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(session_id,form_id))",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS form_responses (id TEXT PRIMARY KEY, publication_id TEXT NOT NULL REFERENCES form_publications(id) ON DELETE CASCADE, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, form_id TEXT NOT NULL, revision INTEGER NOT NULL, definition TEXT NOT NULL, answers TEXT NOT NULL, respondent_id TEXT, respondent_name TEXT, respondent_email TEXT, submission_id TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(publication_id,submission_id))",
    );
    await sql.run(
      "CREATE INDEX IF NOT EXISTS form_responses_session_idx ON form_responses(session_id,form_id,created_at)",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS form_response_images(response_id TEXT NOT NULL REFERENCES form_responses(id) ON DELETE CASCADE,question_id TEXT NOT NULL,mime TEXT NOT NULL,base64 TEXT NOT NULL,PRIMARY KEY(response_id,question_id))",
    );
    // Running totals per publication, so quota checks never re-read stored
    // images. Rows are created on first use from the existing responses.
    await sql.run(
      "CREATE TABLE IF NOT EXISTS form_publication_usage(publication_id TEXT PRIMARY KEY REFERENCES form_publications(id) ON DELETE CASCADE,responses INTEGER NOT NULL,bytes BIGINT NOT NULL)",
    );
  });
  /** Current totals of a publication; the caller holds its row lock. */
  const usage = async (sql: Sql, publicationId: string) => {
    const [row] = await sql.all<{ responses: number; bytes: number | string }>(
      "SELECT responses,bytes FROM form_publication_usage WHERE publication_id=$1",
      [publicationId],
    );
    if (row)
      return { responses: Number(row.responses), bytes: Number(row.bytes) };
    const [answers] = await sql.all<{
      count: number | string;
      size: number | string | null;
    }>(
      "SELECT COUNT(*) AS count,SUM(LENGTH(answers)) AS size FROM form_responses WHERE publication_id=$1",
      [publicationId],
    );
    const [images] = await sql.all<{ size: number | string | null }>(
      "SELECT SUM(LENGTH(i.base64)) AS size FROM form_response_images i JOIN form_responses r ON r.id=i.response_id WHERE r.publication_id=$1",
      [publicationId],
    );
    const current = {
      responses: Number(answers.count),
      bytes: Number(answers.size ?? 0) + Number(images.size ?? 0),
    };
    await sql.run(
      "INSERT INTO form_publication_usage(publication_id,responses,bytes) VALUES($1,$2,$3)",
      [publicationId, current.responses, current.bytes],
    );
    return current;
  };
  const formAccess = async (
    request: Request,
    response: Response,
    allowed: Role[],
  ) => {
    const result = await accessible(
      parameter(request, "id"),
      who(response)!.id,
      allowed,
    );
    const form = result.session.forms?.find(
      (value) => value.id === parameter(request, "formId"),
    );
    if (!form) return missing();
    return { ...result, form };
  };
  const lockSession = async (sql: Sql, session: Session, version: number) => {
    if (
      version !== session.version ||
      !(await sql.run(
        "UPDATE sessions SET version = version WHERE id = $1 AND version = $2",
        [session.id, version],
      ))
    )
      return fail(
        409,
        "VERSION_CONFLICT",
        "Save or reload this agenda before publishing.",
      );
    await guardSessionLifecycle(sql, session.id, { write: true });
  };
  const prefix = "/api/sessions/:id/forms/:formId";
  app.get(`${prefix}/publication`, authenticated, async (request, response) => {
    const { session, form } = await formAccess(request, response, [
      "owner",
      "editor",
    ]);
    const [row] = await db.all<PublicationRow>(
      "SELECT * FROM form_publications WHERE session_id = $1 AND form_id = $2",
      [session.id, form.id],
    );
    response.json({ publication: row ? metadata(row) : null });
  });
  app.post(`${prefix}/publish`, authenticated, async (request, response) => {
    const { version } = expected.parse(request.body),
      { session, form } = await formAccess(request, response, [
        "owner",
        "editor",
      ]);
    if (!form.questions.length)
      return fail(400, "FORM_EMPTY", "Add a question before publishing.");
    const definition = JSON.stringify(formSchema.parse(form));
    const publication = await db.transaction(async (sql) => {
      await lockSession(sql, session, version);
      const [prior] = await sql.all<PublicationRow>(
        "SELECT * FROM form_publications WHERE session_id = $1 AND form_id = $2",
        [session.id, form.id],
      );
      const now = new Date().toISOString();
      if (prior) {
        await sql.run(
          "UPDATE form_publications SET enabled = 1, definition = $1, revision = $2, updated_at = $3 WHERE id = $4",
          [definition, prior.revision + 1, now, prior.id],
        );
        return metadata({
          ...prior,
          enabled: 1,
          definition,
          revision: prior.revision + 1,
          updated_at: now,
        });
      }
      const raw = token(),
        row: PublicationRow = {
          id: randomUUID(),
          session_id: session.id,
          form_id: form.id,
          token_hash: hashToken(raw),
          enabled: 1,
          definition,
          revision: 1,
          created_at: now,
          updated_at: now,
        };
      await sql.run(
        "INSERT INTO form_publications(id,session_id,form_id,token_hash,enabled,definition,revision,created_at,updated_at) VALUES($1,$2,$3,$4,1,$5,1,$6,$6)",
        [row.id, session.id, form.id, row.token_hash, definition, now],
      );
      return { ...metadata(row), token: raw };
    });
    response.json({ publication });
  });
  for (const action of ["unpublish", "rotate"] as const)
    app.post(
      `${prefix}/${action}`,
      authenticated,
      async (request, response) => {
        const { version } = expected.parse(request.body),
          { session, form } = await formAccess(request, response, [
            "owner",
            "editor",
          ]);
        const result = await db.transaction(async (sql) => {
          await lockSession(sql, session, version);
          const [prior] = await sql.all<PublicationRow>(
            "SELECT * FROM form_publications WHERE session_id = $1 AND form_id = $2",
            [session.id, form.id],
          );
          if (!prior) return missing();
          const raw = action === "rotate" ? token() : undefined,
            now = new Date().toISOString();
          await sql.run(
            "UPDATE form_publications SET enabled = $1, token_hash = $2, revision = $3, updated_at = $4 WHERE id = $5",
            [
              action === "unpublish" ? 0 : prior.enabled,
              raw ? hashToken(raw) : prior.token_hash,
              prior.revision + 1,
              now,
              prior.id,
            ],
          );
          return {
            ...metadata({
              ...prior,
              enabled: action === "unpublish" ? 0 : prior.enabled,
              revision: prior.revision + 1,
              updated_at: now,
            }),
            ...(raw ? { token: raw } : {}),
          };
        });
        response.json({ publication: result });
      },
    );
  app.get(`${prefix}/responses`, authenticated, async (request, response) => {
    const { session, form } = await formAccess(request, response, [
      "owner",
      "editor",
    ]);
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .default(0)
      .parse(request.query.offset);
    const rows = await db.all<ResponseRow>(
      "SELECT * FROM form_responses WHERE session_id = $1 AND form_id = $2 ORDER BY created_at DESC,id DESC LIMIT 100 OFFSET $3",
      [session.id, form.id, offset],
    );
    const [count] = await db.all<{ total: string | number }>(
      "SELECT COUNT(*) AS total FROM form_responses WHERE session_id = $1 AND form_id = $2",
      [session.id, form.id],
    );
    response.json({
      responses: rows.map(responseValue),
      total: Number(count.total),
      nextOffset:
        offset + rows.length < Number(count.total)
          ? offset + rows.length
          : null,
    });
  });
  app.delete(
    `${prefix}/responses/:responseId`,
    authenticated,
    async (request, response) => {
      const { session, form } = await formAccess(request, response, ["owner"]);
      await db.transaction(async (sql) => {
        const [row] = await sql.all<{
          publication_id: string;
          answers: string;
        }>(
          "SELECT publication_id,answers FROM form_responses WHERE id = $1 AND session_id = $2 AND form_id = $3",
          [parameter(request, "responseId"), session.id, form.id],
        );
        if (!row) return;
        const images = await sql.all<{ base64: string }>(
          "SELECT base64 FROM form_response_images WHERE response_id = $1",
          [parameter(request, "responseId")],
        );
        const size =
          row.answers.length +
          images.reduce((total, image) => total + image.base64.length, 0);
        await sql.run(
          "DELETE FROM form_responses WHERE id = $1 AND session_id = $2 AND form_id = $3",
          [parameter(request, "responseId"), session.id, form.id],
        );
        // Deleting responses frees room under the publication's quota.
        await sql.run(
          "UPDATE form_publication_usage SET responses = CASE WHEN responses > 0 THEN responses - 1 ELSE 0 END, bytes = CASE WHEN bytes > $1 THEN bytes - $1 ELSE 0 END WHERE publication_id = $2",
          [size, row.publication_id],
        );
      });
      response.status(204).end();
    },
  );
  app.get(
    `${prefix}/responses/:responseId/images/:questionId`,
    authenticated,
    async (request, response) => {
      const { session, form } = await formAccess(request, response, [
        "owner",
        "editor",
      ]);
      const [image] = await db.all<{ mime: string; base64: string }>(
        "SELECT i.mime,i.base64 FROM form_response_images i JOIN form_responses r ON r.id=i.response_id WHERE r.session_id=$1 AND r.form_id=$2 AND i.response_id=$3 AND i.question_id=$4",
        [
          session.id,
          form.id,
          parameter(request, "responseId"),
          parameter(request, "questionId"),
        ],
      );
      if (!image) return missing();
      response.setHeader("Content-Type", image.mime);
      response.setHeader("Content-Disposition", "inline");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; sandbox",
      );
      response.send(Buffer.from(image.base64, "base64"));
    },
  );
  const byToken = async (
    sql: Sql,
    raw: string,
    lock = false,
    shareFormId?: string,
  ) => {
    if (!/^[A-Za-z0-9_-]{43}$/.test(raw)) return missing();
    let sharedSessionId: string | undefined;
    if (shareFormId) {
      const [share] = await sql.all<{
        session_id: string;
        options: string | null;
      }>(
        "SELECT l.session_id,o.payload AS options FROM shares l LEFT JOIN share_options o ON o.share_id=l.id WHERE l.token_hash=$1 AND (l.expires_at IS NULL OR l.expires_at>$2)",
        [hashToken(raw), new Date().toISOString()],
      );
      if (!share) return missing();
      const options = sharingSchema.parse(
        share.options ? JSON.parse(share.options) : {},
      );
      if (
        !options.enabled ||
        options.mode !== "visitor" ||
        !options.formIds.includes(shareFormId)
      )
        return missing();
      sharedSessionId = share.session_id;
    }
    const [row] = await sql.all<PublicationRow>(
      sharedSessionId
        ? "SELECT * FROM form_publications WHERE session_id=$1 AND form_id=$2 AND enabled=1"
        : "SELECT * FROM form_publications WHERE token_hash = $1 AND enabled = 1",
      sharedSessionId ? [sharedSessionId, shareFormId!] : [hashToken(raw)],
    );
    if (!row) return missing();
    if (lock)
      await sql.run("UPDATE sessions SET version = version WHERE id = $1", [
        row.session_id,
      ]);
    await guardSessionLifecycle(sql, row.session_id, { write: true });
    const [parent] = await sql.all<{ payload: string }>(
      "SELECT payload FROM sessions WHERE id = $1",
      [row.session_id],
    );
    const session = parent ? (JSON.parse(parent.payload) as Session) : null;
    if (
      !session?.forms?.some((form) => form.id === row.form_id) ||
      session.archived
    )
      return missing();
    return { row, session, form: formSchema.parse(JSON.parse(row.definition)) };
  };
  app.get(
    ["/api/forms/:token", "/api/public/:token/forms/:formId"],
    async (request, response) => {
      const { row, session, form } = await byToken(
        db,
        parameter(request, "token"),
        false,
        request.params.formId as string | undefined,
      );
      const identity = form.identityMode === "anonymous" ? null : who(response);
      response.json({
        form,
        sessionTitle: session.title,
        revision: row.revision,
        identity: identity
          ? { name: identity.name, email: identity.email }
          : null,
      });
    },
  );
  const submitLimiter: RequestHandler =
    rateLimits === false
      ? (_request, _response, next) => next()
      : rateLimit(30, 10 * 60000);
  app.post(
    [
      "/api/forms/:token/responses",
      "/api/public/:token/forms/:formId/responses",
    ],
    submitLimiter,
    async (request, response) => {
      const body = z
        .object({
          revision: z.number().int().positive(),
          submissionId: z.uuid(),
          shareIdentity: z.boolean().default(false),
          answers: z.unknown(),
        })
        .strict()
        .parse(request.body);
      const result = await db.transaction(async (sql) => {
        const { row, form } = await byToken(
          sql,
          parameter(request, "token"),
          true,
          request.params.formId as string | undefined,
        );
        const locked = await sql.run(
          "UPDATE form_publications SET revision = revision WHERE id = $1 AND revision = $2 AND enabled = 1",
          [row.id, body.revision],
        );
        if (!locked || row.revision !== body.revision)
          return fail(
            409,
            "FORM_CHANGED",
            "This form changed. Reload it before submitting.",
          );
        const validated = validateFormAnswers(form, body.answers);
        if (Object.keys(validated.errors).length)
          return fail(
            400,
            "FORM_ANSWERS_INVALID",
            "Some answers are missing or invalid.",
          );
        const images = form.questions.flatMap((question) => {
          if (question.type !== "image" || !validated.answers[question.id])
            return [];
          const raw = validated.answers[question.id] as string,
            image = parseFormImage(raw)!;
          validated.answers[question.id] = `image:${hashToken(raw)}`;
          return [{ questionId: question.id, ...image }];
        });
        const answers = JSON.stringify(validated.answers);
        const [prior] = await sql.all<ResponseRow>(
          "SELECT * FROM form_responses WHERE publication_id = $1 AND submission_id = $2",
          [row.id, body.submissionId],
        );
        if (prior) {
          if (prior.answers !== answers)
            return fail(
              409,
              "FORM_SUBMISSION_CONFLICT",
              "This submission identifier was already used.",
            );
          return { id: prior.id, createdAt: prior.created_at };
        }
        // The publication row is locked above, so parallel submissions
        // cannot race past these totals.
        const size =
          answers.length +
          images.reduce((total, image) => total + image.base64.length, 0);
        const current = await usage(sql, row.id);
        if (
          current.responses >= quotas.formResponses ||
          current.bytes + size > quotas.formBytes
        )
          return fail(
            409,
            "FORM_FULL",
            "This form is not accepting more responses.",
          );
        const identity =
          form.identityMode === "anonymous" ||
          (form.identityMode === "optional" && !body.shareIdentity)
            ? undefined
            : who(response);
        const id = randomUUID(),
          now = new Date().toISOString();
        await sql.run(
          "INSERT INTO form_responses(id,publication_id,session_id,form_id,revision,definition,answers,respondent_id,respondent_name,respondent_email,submission_id,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
          [
            id,
            row.id,
            row.session_id,
            row.form_id,
            row.revision,
            row.definition,
            answers,
            identity?.id ?? null,
            identity?.name ?? null,
            identity?.email ?? null,
            body.submissionId,
            now,
          ],
        );
        for (const image of images)
          await sql.run(
            "INSERT INTO form_response_images(response_id,question_id,mime,base64) VALUES($1,$2,$3,$4)",
            [id, image.questionId, image.mime, image.base64],
          );
        await sql.run(
          "UPDATE form_publication_usage SET responses = responses + 1, bytes = bytes + $1 WHERE publication_id = $2",
          [size, row.id],
        );
        return { id, createdAt: now };
      });
      response.status(201).json({ response: result });
    },
  );
}
