import express, { type Request, type Response } from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { Session, Role, User } from "../shared/model.js";
import { DEFAULT_SOUND, INITIAL_RUN } from "../shared/model.js";
import {
  createSession,
  transitionRun,
  allBlocks,
  cloneBlockTree,
  runnableBlocks,
  totalDuration,
  reconcileAutomaticExtension,
} from "../shared/domain.js";
import {
  editableSessionSchema,
  sessionInputSchema,
  soundSchema,
} from "../shared/validation.js";
import { openDatabase, type Database, type Sql } from "./db.js";
import {
  constantEqual,
  DUMMY_PASSWORD_HASH,
  fail,
  hashPassword,
  hashToken,
  HttpError,
  rateLimit,
  token,
  verifyPassword,
  withRateLimitStores,
} from "./security.js";
import { assistAgenda, generateAgenda, type AiConfig } from "./ai.js";
import { createPresenceRouter } from "./presence.js";
import { registerOperations } from "./operations.js";
import { registerAnnouncement } from "./announcement.js";
import { createRunTables, installRunsApi, recordFinishedRun } from "./runs.js";
import { DEFAULT_ISSUES_URL, registerFeedback } from "./feedback.js";
import { log } from "./log.js";
import { registerLogs, type LogConfig } from "./logs.js";
import {
  DEFAULT_MAX_ARCHIVE_BYTES,
  importBodyParser,
  registerBackups,
  type BackupConfig,
} from "./backups.js";
import { appVersion, type AppVersion } from "./version.js";
import { registerSharing } from "./sharing.js";
import { audit } from "./audit.js";
import {
  publicQuotas,
  requestBudget,
  type PublicQuotas,
  type RequestBudget,
} from "./quotas.js";
import { installTransfersApi } from "./transfers.js";
import { installAccountsApi, accountProfile } from "./accounts.js";
import { cloneContent } from "../shared/content.js";
import { installContentApi } from "./content-api.js";
import { installAiApi } from "./ai-api.js";
import { installDocumentApi } from "./document-api.js";
import { installFormAiApi } from "./form-ai.js";
import { installMcpApi } from "./mcp.js";
import { installExportPresets } from "./export-presets.js";
import { installExportAi } from "./export-ai.js";
import { installHistoryApi, recordHistory } from "./history.js";
import { installCommentsApi, recordMentionNotifications } from "./comments.js";
import { installOidcApi, type OidcConfig, type OidcAdapter } from "./oidc.js";
import {
  installMailApi,
  type MailConfig,
  type MailTransport,
} from "./mailer.js";
import {
  installParticipantsApi,
  acceptParticipantInvite,
  normalizeAssignments,
} from "./participants.js";
import {
  installWorkspacesApi,
  accessibleSessionRows,
  mappedSession,
  storedSession,
  applyWorkspaceDefaults,
  acceptWorkspaceInvite,
  workspaceAccess,
} from "./workspaces.js";
import {
  initializeLifecycle,
  installLifecycleApi,
  guardSessionLifecycle,
} from "./lifecycle.js";
import {
  initializeFolders,
  installFoldersApi,
  recordSessionFolders,
} from "./folders.js";
import { installActivityApi, sessionReadMarkers } from "./activity.js";

export interface AppConfig {
  /** Defaults to the image's APP_VERSION/APP_REVISION or package.json. */
  version?: AppVersion;
  /** Scheduled backups and the largest archive accepted. */
  backups?: BackupConfig;
  databaseUrl?: string;
  sqlitePath?: string;
  database?: Database;
  origin?: string;
  secureCookie?: boolean;
  trustProxy?: number;
  bootstrapToken?: string;
  ai?: AiConfig;
  clientPath?: string;
  authTtlMs?: number;
  rateLimits?: boolean;
  oidc?: OidcConfig;
  oidcAdapter?: OidcAdapter;
  mail?: MailConfig;
  mailTransport?: MailTransport;
  /** Caps on data stored through public links; defaults in quotas.ts. */
  quotas?: Partial<PublicQuotas>;
  /** Requests per minute across the API; defaults in quotas.ts. */
  requestBudget?: Partial<RequestBudget>;
  /** Where administrators forward user reports; "" hides the link. */
  feedbackIssuesUrl?: string;
  /** How long server log lines stay readable in the application. */
  logs?: LogConfig;
}
type UserRow = {
  id: string;
  name: string;
  email: string;
  locale: "fr" | "en";
  password: string;
  is_admin: number;
};
type SessionRow = {
  id: string;
  owner_id: string;
  payload: string;
  version: number;
  role?: Role;
};
const locale = z.enum(["fr", "en"]);
const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase().trim());
const password = z.string().min(12).max(256);
const name = z.string().trim().min(1).max(120);
/** Self-service sign-up, open by default like SessionLab: anyone creates an
 * account with their email and manages their own sessions. Administrators can
 * restrict it to email domains or close it (invitations only). */
const signupSchema = z.object({
  enabled: z.boolean(),
  domains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(
          /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
        ),
    )
    .max(20),
});
type SignupPolicy = z.infer<typeof signupSchema>;
const idSchema = z.string().min(1).max(120);
const publicUser = (row: UserRow): User => ({
  id: row.id,
  name: row.name,
  email: row.email,
  locale: row.locale,
  isAdmin: !!row.is_admin,
});
const user = (response: Response) => response.locals.user as User;
const param = (request: Request, key: string) =>
  idSchema.parse(request.params[key]);
const missing = () =>
  fail(404, "NOT_FOUND", "The requested resource was not found.");
// Client documents may contain server state. Select only editable fields before
// validation so a forged owner/version/run can never cross this boundary.
function editable(value: unknown) {
  const input = z.record(z.string(), z.unknown()).parse(value);
  return editableSessionSchema.parse(
    Object.fromEntries(
      [
        "title",
        "editorLayout",
        "description",
        "client",
        "tags",
        "folder",
        "categories",
        "pages",
        "forms",
        "contentOrder",
        "timezone",
        "days",
        "columns",
        "sound",
        "archived",
      ].map((key) => [key, input[key]]),
    ),
  );
}

export async function createApp(config: AppConfig = {}) {
  const { result: runtime, shutdown } = await withRateLimitStores(() =>
    assembleApp(config),
  );
  return {
    ...runtime,
    close: async () => {
      shutdown();
      await runtime.close();
    },
  };
}

async function assembleApp(config: AppConfig) {
  const db = config.database ?? (await openDatabase(config));
  try {
    return await assembleWith(db, config);
  } catch (error) {
    // Only close a database this function opened.
    if (!config.database) await db.close();
    throw error;
  }
}

async function assembleWith(db: Database, config: AppConfig) {
  await initializeLifecycle(db);
  const app = express();
  const cookieOptions = {
    httpOnly: true,
    secure: config.secureCookie ?? false,
    sameSite: "strict" as const,
    path: "/",
  };
  const authCookie = cookieOptions.secure
    ? "__Host-meetloom_session"
    : "meetloom_session";
  const authTtl = config.authTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", config.trustProxy);
  app.use(
    helmet({
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: "no-referrer" },
      // Everything is self-hosted (internal and air-gapped networks): helmet's
      // defaults would also allow fonts and styles from any HTTPS origin.
      contentSecurityPolicy: {
        directives: {
          "font-src": ["'self'", "data:"],
          "style-src": ["'self'", "'unsafe-inline'"],
        },
      },
    }),
  );
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    // Timers run on the server clock: browsers use this to correct their own.
    response.setHeader("X-Server-Time", String(Date.now()));
    next();
  });
  app.get("/api/health", (_request, response) =>
    response.json({ status: "ok" }),
  );
  app.get("/api/ready", async (_request, response) => {
    try {
      await db.all("SELECT 1");
      response.json({ status: "ready" });
    } catch {
      response.status(503).json({ status: "unavailable" });
    }
  });
  const budget = requestBudget(config.requestBudget);
  // A flood guard per address, high enough for a meeting room of visitors
  // behind one NAT or proxy; signed-in users get their own budget below.
  if (config.rateLimits !== false)
    app.use("/api", rateLimit(budget.perAddress, 60000));
  app.use("/api", (request, _response, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      if (request.get("Sec-Fetch-Site") === "cross-site")
        return next(
          new HttpError(
            403,
            "ORIGIN_REJECTED",
            "Cross-site requests are not allowed.",
          ),
        );
      const supplied = request.get("Origin");
      const expected =
        config.origin ?? `${request.protocol}://${request.get("host")}`;
      if (!supplied || supplied !== new URL(expected).origin)
        return next(
          new HttpError(
            403,
            "ORIGIN_REJECTED",
            "A matching request origin is required.",
          ),
        );
      // req.is() returns null for an empty DELETE despite a correct JSON header.
      if (
        !/^application\/json(?:\s*;|\s*$)/i.test(
          request.get("Content-Type") ?? "",
        )
      )
        return next(
          new HttpError(415, "JSON_REQUIRED", "Use application/json."),
        );
    }
    next();
  });
  app.use("/api", async (request, response, next) => {
    const raw = (request.get("Cookie") ?? "")
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${authCookie}=`))
      ?.slice(authCookie.length + 1);
    if (raw && /^[A-Za-z0-9_-]{43}$/.test(raw)) {
      const rows = await db.all<UserRow>(
        "SELECT u.* FROM users u JOIN auth_sessions a ON a.user_id = u.id WHERE a.token_hash = $1 AND a.expires_at > $2 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=u.id)",
        [hashToken(raw), Date.now()],
      );
      if (rows[0]) {
        response.locals.user = {
          ...publicUser(rows[0]),
          avatar: (await accountProfile(db, rows[0].id)).avatar,
        };
        response.locals.authHash = hashToken(raw);
      }
    }
    next();
  });
  if (config.rateLimits !== false) {
    const perUser = rateLimit(
      budget.perUser,
      60000,
      (_request, response) => `user:${(response.locals.user as User).id}`,
    );
    app.use("/api", (request, response, next) =>
      response.locals.user ? perUser(request, response, next) : next(),
    );
  }
  // Bodies are parsed after the session cookie is resolved, so the larger
  // import limit is only ever spent on signed-in users.
  app.use(
    "/api/import/extract",
    (_request, response, next) =>
      response.locals.user
        ? next()
        : next(new HttpError(401, "UNAUTHENTICATED", "Please sign in.")),
    express.json({ limit: "7mb", strict: true }),
  );
  app.use(
    "/api/admin/data/import",
    ...importBodyParser(
      config.backups?.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES,
    ),
  );
  app.use(express.json({ limit: "1mb", strict: true }));
  const authenticated = (
    _request: Request,
    response: Response,
    next: express.NextFunction,
  ) =>
    response.locals.user
      ? next()
      : next(new HttpError(401, "UNAUTHENTICATED", "Please sign in."));
  const admin = (
    request: Request,
    response: Response,
    next: express.NextFunction,
  ) =>
    authenticated(request, response, (error) => {
      if (error) return next(error);
      return user(response).isAdmin
        ? next()
        : next(
            new HttpError(
              403,
              "FORBIDDEN",
              "Administrator access is required.",
            ),
          );
    });
  await installWorkspacesApi(app, { db, authenticated, accessible });
  await initializeFolders(db);
  await installFoldersApi(app, { db, authenticated });
  await installActivityApi(app, { db, authenticated, accessible });
  await installLifecycleApi(app, { db, authenticated });
  await installAccountsApi(app, {
    db,
    authenticated,
    admin,
    issueAuth,
    setAuth,
    rateLimits: config.rateLimits,
  });
  await installParticipantsApi(app, { db, authenticated, accessible });
  await installOidcApi(app, {
    db,
    config: config.oidc,
    origin: config.origin,
    secureCookie: !!config.secureCookie,
    issueAuth,
    setAuth,
    rateLimits: config.rateLimits,
    adapter: config.oidcAdapter,
    acceptInvite: async (sql, hash, userId) => {
      await acceptWorkspaceInvite(sql, hash, userId);
      await acceptParticipantInvite(sql, hash, userId);
    },
  });
  const mail = await installMailApi(app, {
    db,
    config: config.mail,
    origin: config.origin,
    transport: config.mailTransport,
    rateLimits: config.rateLimits,
  });
  const authLimiter =
    config.rateLimits === false
      ? (_request: Request, _response: Response, next: express.NextFunction) =>
          next()
      : rateLimit(20, 15 * 60000);

  async function issueAuth(sql: Sql, userId: string): Promise<string> {
    if (
      (
        await sql.all("SELECT user_id FROM account_disabled WHERE user_id=$1", [
          userId,
        ])
      ).length
    )
      return fail(401, "INVALID_CREDENTIALS", "This account is unavailable.");
    const raw = token();
    await sql.run("DELETE FROM auth_sessions WHERE expires_at <= $1", [
      Date.now(),
    ]);
    await sql.run(
      "INSERT INTO auth_sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
      [hashToken(raw), userId, Date.now() + authTtl],
    );
    return raw;
  }
  function setAuth(response: Response, raw: string) {
    response.cookie(authCookie, raw, { ...cookieOptions, maxAge: authTtl });
  }
  async function signupPolicy(): Promise<SignupPolicy> {
    const [row] = await db.all<{ payload: string }>(
      "SELECT payload FROM app_settings WHERE id = $1",
      ["signup"],
    );
    return row
      ? signupSchema.parse(JSON.parse(row.payload))
      : { enabled: true, domains: [] };
  }
  app.get("/api/auth/status", async (_request, response) => {
    const initialized =
      (await db.all("SELECT id FROM bootstrap WHERE id = 1")).length > 0;
    const signup = await signupPolicy();
    response.json({
      signupEnabled: initialized && signup.enabled,
      signupDomains: signup.enabled ? signup.domains : [],
      needsSetup: !initialized,
      user: response.locals.user ?? null,
      aiEnabled: !!config.ai?.baseUrl,
      requiresBootstrapToken: !!config.bootstrapToken,
      oidcEnabled: !!config.oidc,
      passwordResetEnabled: !!config.mail,
    });
  });
  app.post("/api/auth/setup", authLimiter, async (request, response) => {
    const input = z
      .object({
        name,
        email,
        password,
        locale: locale.default("fr"),
        bootstrapToken: z.string().max(256).optional(),
      })
      .parse(request.body);
    if (
      config.bootstrapToken &&
      !constantEqual(input.bootstrapToken ?? "", config.bootstrapToken)
    )
      return fail(
        403,
        "BOOTSTRAP_TOKEN_REQUIRED",
        "The installation key is invalid.",
      );
    const encoded = await hashPassword(input.password);
    const row: UserRow = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      locale: input.locale,
      password: encoded,
      is_admin: 1,
    };
    let raw: string;
    try {
      raw = await db.transaction(async (sql) => {
        if ((await sql.all("SELECT id FROM bootstrap WHERE id = 1")).length)
          return fail(
            409,
            "ALREADY_INITIALIZED",
            "The installation already has an administrator.",
          );
        await sql.run(
          "INSERT INTO users(id,name,email,locale,password,is_admin,created_at) VALUES($1,$2,$3,$4,$5,1,$6)",
          [
            row.id,
            row.name,
            row.email,
            row.locale,
            encoded,
            new Date().toISOString(),
          ],
        );
        await sql.run("INSERT INTO bootstrap(id,user_id) VALUES(1,$1)", [
          row.id,
        ]);
        await audit(sql, request, response, "installation.setup", {
          target: row.id,
          actorId: row.id,
        });
        return issueAuth(sql, row.id);
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (isUniqueViolation(error))
        return fail(
          409,
          "ALREADY_INITIALIZED",
          "The installation already has an administrator.",
        );
      throw error;
    }
    setAuth(response, raw);
    response.status(201).json({ user: publicUser(row) });
  });
  app.post("/api/auth/signup", authLimiter, async (request, response) => {
    const input = z
      .object({ name, email, password, locale: locale.default("fr") })
      .parse(request.body);
    const policy = await signupPolicy();
    if (!policy.enabled)
      return fail(
        403,
        "SIGNUP_DISABLED",
        "Accounts are created by invitation on this installation.",
      );
    const domain = input.email.split("@").at(-1)!.toLowerCase();
    if (policy.domains.length && !policy.domains.includes(domain))
      return fail(
        403,
        "SIGNUP_DOMAIN",
        "This email domain cannot create an account here.",
      );
    const encoded = await hashPassword(input.password);
    const row: UserRow = {
      id: randomUUID(),
      name: input.name,
      email: input.email,
      locale: input.locale,
      password: encoded,
      is_admin: 0,
    };
    let raw: string;
    try {
      raw = await db.transaction(async (sql) => {
        if (!(await sql.all("SELECT id FROM bootstrap WHERE id = 1")).length)
          return fail(
            409,
            "SETUP_REQUIRED",
            "The installation has no administrator yet.",
          );
        await sql.run(
          "INSERT INTO users(id,name,email,locale,password,is_admin,created_at) VALUES($1,$2,$3,$4,$5,0,$6)",
          [
            row.id,
            row.name,
            row.email,
            row.locale,
            encoded,
            new Date().toISOString(),
          ],
        );
        return issueAuth(sql, row.id);
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (isUniqueViolation(error))
        return fail(
          409,
          "ACCOUNT_EXISTS",
          "An account already exists for this email.",
        );
      throw error;
    }
    setAuth(response, raw);
    response.status(201).json({ user: publicUser(row) });
  });
  app.get("/api/admin/settings", admin, async (_request, response) => {
    // Services are operator configuration (environment, ConfigMap, Secret):
    // shown read-only here, never editable from the browser.
    response.json({
      signup: await signupPolicy(),
      services: {
        smtp: !!config.mail,
        oidc: !!config.oidc,
        ai: config.ai?.baseUrl
          ? {
              model: config.ai.model ?? null,
              visionModel: config.ai.visionModel ?? null,
              allowSelfSigned: !!config.ai.allowSelfSigned,
            }
          : null,
      },
    });
  });
  app.put("/api/admin/settings/signup", admin, async (request, response) => {
    const signup = signupSchema.parse(request.body);
    signup.domains = [...new Set(signup.domains)];
    await db.transaction(async (sql) => {
      await sql.run(
        "INSERT INTO app_settings(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
        ["signup", JSON.stringify(signup)],
      );
      await audit(sql, request, response, "settings.signup", {
        detail: { enabled: signup.enabled, domains: signup.domains.length },
      });
    });
    response.json({ signup });
  });
  app.post("/api/auth/login", authLimiter, async (request, response) => {
    const input = z
      .object({ email, password: z.string().max(256) })
      .parse(request.body);
    const [row] = await db.all<UserRow>(
      "SELECT * FROM users WHERE email = $1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
      [input.email],
    );
    // Run the same password KDF for unknown accounts to limit email enumeration by timing.
    const valid = await verifyPassword(
      input.password,
      row?.password ?? DUMMY_PASSWORD_HASH,
    );
    if (!row || !valid)
      return fail(
        401,
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
      );
    const encoded =
      row.password.split(":").length === 3
        ? await hashPassword(input.password)
        : row.password;
    const raw = await db.transaction(async (sql) => {
      // The row lock/CAS serializes issuance with password changes. A login
      // verified before a password change cannot restore a revoked session.
      const matched = await sql.run(
        "UPDATE users SET password = $1 WHERE id = $2 AND password = $3",
        [encoded, row.id, row.password],
      );
      if (!matched)
        return fail(
          401,
          "INVALID_CREDENTIALS",
          "Email or password is incorrect.",
        );
      return issueAuth(sql, row.id);
    });
    setAuth(response, raw);
    response.json({ user: publicUser(row) });
  });
  app.post(
    "/api/auth/password",
    authenticated,
    authLimiter,
    async (request, response) => {
      const input = z
        .object({
          currentPassword: z.string().min(1).max(256),
          newPassword: password,
        })
        .strict()
        .parse(request.body);
      const [row] = await db.all<UserRow>("SELECT * FROM users WHERE id = $1", [
        user(response).id,
      ]);
      if (!row || !(await verifyPassword(input.currentPassword, row.password)))
        return fail(
          401,
          "INVALID_CREDENTIALS",
          "The current password is incorrect.",
        );
      const encoded = await hashPassword(input.newPassword);
      const raw = await db.transaction(async (sql) => {
        const changed = await sql.run(
          "UPDATE users SET password = $1 WHERE id = $2 AND password = $3",
          [encoded, row.id, row.password],
        );
        if (!changed)
          return fail(
            409,
            "PASSWORD_CHANGED",
            "The password was changed by another request. Please sign in again.",
          );
        await sql.run("DELETE FROM auth_sessions WHERE user_id = $1", [row.id]);
        await sql.run("DELETE FROM account_resets WHERE user_id = $1", [
          row.id,
        ]);
        return issueAuth(sql, row.id);
      });
      setAuth(response, raw);
      response.json({ user: publicUser(row) });
    },
  );
  app.post("/api/auth/logout", async (_request, response) => {
    if (response.locals.authHash)
      await db.run("DELETE FROM auth_sessions WHERE token_hash = $1", [
        response.locals.authHash,
      ]);
    response.clearCookie(authCookie, cookieOptions).json({ ok: true });
  });
  app.post("/api/auth/invites", admin, async (request, response) => {
    const input = z
      .object({
        name,
        email,
        role: z.enum(["editor", "facilitator", "viewer"]).optional(),
      })
      .parse(request.body);
    if (
      (await db.all("SELECT id FROM users WHERE email = $1", [input.email]))
        .length
    )
      return fail(
        409,
        "ACCOUNT_EXISTS",
        "An account already exists for this email.",
      );
    const raw = token();
    const expires = Date.now() + 72 * 60 * 60 * 1000;
    await db.transaction(async (sql) => {
      await sql.run(
        "DELETE FROM invites WHERE email = $1 OR expires_at <= $2",
        [input.email, Date.now()],
      );
      await sql.run(
        "INSERT INTO invites(token_hash,email,name,expires_at,created_by) VALUES($1,$2,$3,$4,$5)",
        [hashToken(raw), input.email, input.name, expires, user(response).id],
      );
      await audit(sql, request, response, "account.invite", {
        target: input.email,
        detail: { role: input.role ?? null },
      });
    });
    response
      .status(201)
      .json({ token: raw, expiresAt: new Date(expires).toISOString() });
  });
  app.post(
    "/api/auth/accept-invite",
    authLimiter,
    async (request, response) => {
      const input = z
        .object({
          token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
          name,
          password,
          locale: locale.default("fr"),
        })
        .parse(request.body);
      const encoded = await hashPassword(input.password);
      const result = await db.transaction(async (sql) => {
        const [invite] = await sql.all<{ email: string }>(
          "SELECT email FROM invites WHERE token_hash = $1 AND expires_at > $2",
          [hashToken(input.token), Date.now()],
        );
        if (!invite)
          return fail(
            410,
            "INVITE_INVALID",
            "The invitation has expired or has already been used.",
          );
        // DELETE is the atomic consumption point even on concurrent PostgreSQL requests.
        const consumed = await sql.run(
          "DELETE FROM invites WHERE token_hash = $1 AND expires_at > $2",
          [hashToken(input.token), Date.now()],
        );
        if (!consumed)
          return fail(
            410,
            "INVITE_INVALID",
            "The invitation has expired or has already been used.",
          );
        const row: UserRow = {
          id: randomUUID(),
          email: invite.email,
          name: input.name,
          locale: input.locale,
          password: encoded,
          is_admin: 0,
        };
        try {
          await sql.run(
            "INSERT INTO users(id,email,name,locale,password,is_admin,created_at) VALUES($1,$2,$3,$4,$5,0,$6)",
            [
              row.id,
              row.email,
              row.name,
              row.locale,
              row.password,
              new Date().toISOString(),
            ],
          );
        } catch (error) {
          if (isUniqueViolation(error))
            return fail(
              409,
              "ACCOUNT_EXISTS",
              "An account already exists for this email.",
            );
          throw error;
        }
        await acceptWorkspaceInvite(sql, hashToken(input.token), row.id);
        await acceptParticipantInvite(sql, hashToken(input.token), row.id);
        return { user: publicUser(row), raw: await issueAuth(sql, row.id) };
      });
      setAuth(response, result.raw);
      response.status(201).json({ user: result.user });
    },
  );

  async function defaultSound() {
    const [row] = await db.all<{ payload: string }>(
      "SELECT payload FROM app_settings WHERE id = $1",
      ["sound"],
    );
    return row
      ? soundSchema.parse(JSON.parse(row.payload))
      : { ...DEFAULT_SOUND };
  }
  app.get("/api/settings", authenticated, async (_request, response) =>
    response.json({ sound: await defaultSound() }),
  );
  app.put("/api/settings", admin, async (request, response) => {
    const { sound } = z.object({ sound: soundSchema }).parse(request.body);
    await db.transaction(async (sql) => {
      await sql.run(
        "INSERT INTO app_settings(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
        ["sound", JSON.stringify(sound)],
      );
      await audit(sql, request, response, "settings.sound");
    });
    response.json({ sound });
  });

  async function accessible(id: string, userId: string, allowed?: Role[]) {
    const [row] = await accessibleSessionRows(db, userId, id);
    if (!row) return missing();
    const role = row.role as Role;
    if (allowed && !allowed.includes(role))
      return fail(403, "FORBIDDEN", "Your role does not permit this action.");
    return { session: mappedSession(row), role };
  }
  async function save(
    previous: Session,
    candidate: Session,
    author: string,
    label?: string,
    commit?: (sql: Sql, next: Session) => Promise<void>,
    transaction?: Sql,
  ) {
    candidate = reconcileAutomaticExtension(previous, candidate);
    const next: Session = {
      ...candidate,
      days: structuredClone(candidate.days),
      id: previous.id,
      ownerId: previous.ownerId,
      workspaceId: previous.workspaceId,
      createdAt: previous.createdAt,
      version: previous.version + 1,
      updatedAt: new Date().toISOString(),
    };
    const write = async (sql: Sql) => {
      await guardSessionLifecycle(sql, previous.id, { write: true });
      await recordSessionFolders(sql, previous, next);
      await normalizeAssignments(sql, next);
      const changed = await sql.run(
        "UPDATE sessions SET payload = $1, version = $2, updated_at = $3 WHERE id = $4 AND version = $5",
        [
          storedSession(next),
          next.version,
          next.updatedAt,
          previous.id,
          previous.version,
        ],
      );
      if (!changed)
        return fail(
          409,
          "VERSION_CONFLICT",
          "This agenda changed in another window. Reload before saving.",
        );
      for (const form of previous.forms ?? []) {
        if (!next.forms?.some((candidate) => candidate.id === form.id))
          await sql.run(
            "UPDATE form_publications SET enabled = 0 WHERE session_id = $1 AND form_id = $2",
            [previous.id, form.id],
          );
      }
      if (label) {
        await recordHistory(sql, previous, next, author, label);
        await sql.run(
          "INSERT INTO versions(id,session_id,payload,user_id,label,created_at) VALUES($1,$2,$3,$4,$5,$6)",
          [
            randomUUID(),
            previous.id,
            JSON.stringify(previous),
            author,
            label,
            next.updatedAt,
          ],
        );
        await sql.run(
          "DELETE FROM versions WHERE session_id = $1 AND id NOT IN (SELECT version_id FROM version_metadata) AND id NOT IN (SELECT v.id FROM versions v LEFT JOIN version_metadata m ON m.version_id = v.id WHERE v.session_id = $1 AND m.version_id IS NULL ORDER BY v.created_at DESC,v.id DESC LIMIT 100)",
          [previous.id],
        );
      }
      await recordMentionNotifications(sql, previous, next, author);
      await recordFinishedRun(sql, previous, next);
      if (commit) await commit(sql, next);
    };
    if (transaction) await write(transaction);
    else await db.transaction(write);
    return next;
  }
  async function synchronized(session: Session): Promise<Session> {
    if (session.lifecycle?.closedAt) return session;
    const candidate = transitionRun(session, "sync");
    if (candidate === session) return session;
    try {
      return await save(session, candidate, session.ownerId);
    } catch (error) {
      if (error instanceof HttpError && error.status === 409) {
        const [row] = await db.all<
          SessionRow & { workspace_id: string | null }
        >(
          "SELECT s.*,sw.workspace_id,l.closed_at,l.facilitators FROM sessions s LEFT JOIN session_workspaces sw ON sw.session_id=s.id LEFT JOIN session_lifecycle l ON l.session_id=s.id WHERE s.id = $1 AND l.deleted_at IS NULL",
          [session.id],
        );
        if (!row) return missing();
        return mappedSession(row);
      }
      throw error;
    }
  }
  app.use("/api/sessions", authenticated);
  app.get("/api/sessions", async (_request, response) => {
    const rows = await accessibleSessionRows(db, user(response).id);
    const readMarkers = await sessionReadMarkers(db, user(response).id);
    response.json({
      sessions: rows.map((row) => {
        const session = mappedSession(row);
        const blocks = session.days.flatMap((day) => allBlocks(day.blocks));
        return {
          id: session.id,
          title: session.title,
          description: session.description,
          client: session.client,
          tags: session.tags,
          folder: session.folder,
          workspaceId: session.workspaceId,
          closedAt: session.lifecycle?.closedAt,
          unreadActivity:
            session.version >
            (readMarkers.get(session.id)?.version ??
              (session.ownerId === user(response).id ? 1 : 0)),
          lastViewedAt: readMarkers.get(session.id)?.viewed_at,
          updatedAt: session.updatedAt,
          days: session.days.length,
          blocks: blocks.length,
          duration: totalDuration(session),
          role: row.role,
          archived: session.archived,
        };
      }),
    });
  });
  app.post("/api/sessions", async (request, response) => {
    const input = z
      .object({
        title: z.string().trim().min(1).max(200),
        locale: locale.default("fr"),
        demo: z.boolean().default(false),
        workspaceId: idSchema.optional(),
      })
      .parse(request.body);
    let session = createSession(
      user(response).id,
      input.title,
      input.locale,
      input.demo,
    );
    session.sound = await defaultSound();
    await db.transaction(async (sql) => {
      if (input.workspaceId)
        session = await applyWorkspaceDefaults(
          sql,
          session,
          input.workspaceId,
          user(response).id,
        );
      await sql.run(
        "INSERT INTO sessions(id,owner_id,payload,version,updated_at) VALUES($1,$2,$3,$4,$5)",
        [
          session.id,
          session.ownerId,
          storedSession(session),
          session.version,
          session.updatedAt,
        ],
      );
      if (input.workspaceId)
        await sql.run(
          "INSERT INTO session_workspaces(session_id,workspace_id) VALUES($1,$2)",
          [session.id, input.workspaceId],
        );
    });
    response.status(201).json({ session, role: "owner" });
  });
  app.get("/api/sessions/:id", async (request, response) => {
    const result = await accessible(param(request, "id"), user(response).id);
    response.json({ ...result, session: await synchronized(result.session) });
  });
  app.put("/api/sessions/:id", async (request, response) => {
    const body = z
      .object({
        session: z.unknown().transform(editable),
        version: z.number().int().nonnegative(),
      })
      .parse(request.body);
    const { session, role } = await accessible(
      param(request, "id"),
      user(response).id,
      ["owner", "editor"],
    );
    if (body.version !== session.version)
      return fail(
        409,
        "VERSION_CONFLICT",
        "This agenda changed in another window. Reload before saving.",
      );
    const candidate = { ...session, ...body.session };
    const candidateRunDay = candidate.days.find(
      (day) => day.id === session.run.dayId,
    );
    if (
      ["running", "paused"].includes(session.run.status) &&
      !runnableBlocks(candidateRunDay?.blocks ?? []).some(
        (block) => block.id === session.run.blockId,
      )
    )
      return fail(
        409,
        "ACTIVE_BLOCK_REMOVED",
        "Stop the timer before deleting its active block.",
      );
    const runDay = candidate.days.find((day) => day.id === candidate.run.dayId);
    // A finished run points at no block; it stays, with its actual
    // durations, as long as its day exists.
    if (
      candidate.run.status === "finished"
        ? !runDay
        : !runnableBlocks(runDay?.blocks ?? []).some(
            (block) => block.id === candidate.run.blockId,
          )
    )
      candidate.run = {
        ...INITIAL_RUN,
        dayId: candidate.days[0].id,
        revision: session.run.revision + 1,
      };
    response.json({
      session: await save(
        session,
        sessionInputSchema.parse(candidate),
        user(response).id,
        "Agenda edit",
      ),
      role,
    });
  });
  app.post("/api/sessions/:id/duplicate", async (request, response) => {
    const { session } = await accessible(
      param(request, "id"),
      user(response).id,
    );
    const now = new Date().toISOString();
    const suffix = ` — ${user(response).locale === "fr" ? "Copie" : "Copy"}`;
    const days = session.days.map((day) => ({
      ...day,
      id: randomUUID(),
      blocks: day.blocks.map(cloneBlockTree),
    }));
    for (const block of allBlocks(days.flatMap((day) => day.blocks)))
      delete block.assignees;
    const duplicated = {
      ...session,
      workspaceId: undefined,
      lifecycle: undefined,
      ...cloneContent(
        session,
        new Map(session.days.map((day, index) => [day.id, days[index].id])),
      ),
      id: randomUUID(),
      ownerId: user(response).id,
      title: session.title.slice(0, 240 - suffix.length) + suffix,
      version: 1,
      archived: false,
      createdAt: now,
      updatedAt: now,
      days,
      run: { ...INITIAL_RUN, dayId: days[0]?.id ?? "" },
    };
    await db.transaction(async (sql) => {
      await recordSessionFolders(sql, undefined, duplicated);
      await sql.run(
        "INSERT INTO sessions(id,owner_id,payload,version,updated_at) VALUES($1,$2,$3,$4,$5)",
        [
          duplicated.id,
          duplicated.ownerId,
          storedSession(duplicated),
          duplicated.version,
          now,
        ],
      );
    });
    response.status(201).json({ session: duplicated, role: "owner" });
  });
  app.post("/api/sessions/:id/run", async (request, response) => {
    const input = z
      .object({
        action: z.enum([
          "start",
          "pause",
          "resume",
          "next",
          "previous",
          "reset",
          "finish",
          "stop",
          "extend",
          "configure",
          "restore-plan",
          "apply-actual",
        ]),
        dayId: idSchema.optional(),
        blockId: idSchema.optional(),
        autoAdvance: z.boolean().optional(),
        seconds: z.number().int().min(1).max(3600).optional(),
        revision: z.number().int().nonnegative().optional(),
        startMode: z.enum(["now", "planned"]).optional(),
      })
      .parse(request.body);
    const { session, role } = await accessible(
      param(request, "id"),
      user(response).id,
      ["owner", "editor", "facilitator"],
    );
    if (input.revision !== undefined && input.revision !== session.run.revision)
      return fail(409, "RUN_CONFLICT", "The timer changed in another window.");
    if (input.dayId && !session.days.some((day) => day.id === input.dayId))
      return fail(400, "INVALID_DAY", "This day does not exist.");
    const selectedDay = session.days.find(
      (day) => day.id === (input.dayId ?? session.run.dayId),
    );
    if (
      input.blockId &&
      !allBlocks(selectedDay?.blocks ?? []).some(
        (block) => block.id === input.blockId,
      )
    )
      return fail(
        400,
        "INVALID_BLOCK",
        "This block does not exist in the selected day.",
      );
    const now = Date.now();
    let candidate: Session;
    try {
      candidate = transitionRun(
        transitionRun(session, "sync", {}, now),
        input.action === "finish" ? "stop" : input.action,
        input,
        now,
      );
    } catch {
      return fail(
        400,
        input.action === "start" && input.startMode === "planned"
          ? "INVALID_PLANNED_START"
          : "INVALID_RUN_TRANSITION",
        "This timer action cannot be applied to the current agenda.",
      );
    }
    response.json({
      session:
        candidate === session
          ? session
          : await save(session, candidate, user(response).id),
      role,
    });
  });
  const backups = await registerBackups(app, {
    db,
    admin,
    version: config.version ?? appVersion(),
    config: config.backups,
  });
  const operations = await registerOperations(app, {
    db,
    authenticated,
    admin,
    version: config.version ?? appVersion(),
  });
  const logs = await registerLogs(app, { db, admin, config: config.logs });
  await createRunTables(db);
  installRunsApi(app, { db, authenticated, accessible });
  registerAnnouncement(app, { db, admin });
  await registerFeedback(app, {
    db,
    authenticated,
    admin,
    version: config.version ?? appVersion(),
    issuesUrl:
      config.feedbackIssuesUrl === undefined
        ? DEFAULT_ISSUES_URL
        : config.feedbackIssuesUrl || null,
    rateLimits: config.rateLimits,
  });
  await registerSharing(app, {
    db,
    accessible,
    synchronized,
    rateLimits: config.rateLimits,
    quotas: publicQuotas(config.quotas),
    linkVisited: operations.linkVisited,
  });
  installTransfersApi(app, { db, accessible, save });
  app.get("/api/sessions/:id/members", async (request, response) => {
    const { session } = await accessible(
      param(request, "id"),
      user(response).id,
      ["owner"],
    );
    const members = await db.all(
      `SELECT u.id AS "userId",u.name,u.email,CASE WHEN u.id = $2 THEN 'owner' ELSE m.role END AS role FROM users u LEFT JOIN members m ON m.user_id = u.id AND m.session_id = $1 WHERE u.id = $2 OR m.session_id = $1`,
      [session.id, session.ownerId],
    );
    response.json({ members });
  });
  app.post("/api/sessions/:id/members", async (request, response) => {
    const input = z
      .object({ email, role: z.enum(["editor", "facilitator", "viewer"]) })
      .parse(request.body);
    const { session } = await accessible(
      param(request, "id"),
      user(response).id,
      ["owner"],
    );
    const [account] = await db.all<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [input.email],
    );
    if (!account)
      return fail(
        404,
        "ACCOUNT_NOT_FOUND",
        "This person needs to accept an account invitation first.",
      );
    if (account.id === session.ownerId)
      return fail(400, "OWNER_IMMUTABLE", "The owner role cannot be changed.");
    await db.run(
      "INSERT INTO members(session_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(session_id,user_id) DO UPDATE SET role = excluded.role",
      [session.id, account.id, input.role],
    );
    response.status(201).json({ ok: true });
  });
  app.delete("/api/sessions/:id/members/:userId", async (request, response) => {
    const { session } = await accessible(
      param(request, "id"),
      user(response).id,
      ["owner"],
    );
    if (param(request, "userId") === session.ownerId)
      return fail(400, "OWNER_IMMUTABLE", "The owner cannot be removed.");
    if (
      !(await db.run(
        "DELETE FROM members WHERE session_id = $1 AND user_id = $2",
        [session.id, param(request, "userId")],
      ))
    )
      return missing();
    response.json({ ok: true });
  });
  await installCommentsApi(app, { db, accessible, authenticated });
  await installHistoryApi(app, { db, accessible, authenticated, save });
  const aiLimiter =
    config.rateLimits === false
      ? (_request: Request, _response: Response, next: express.NextFunction) =>
          next()
      : rateLimit(10, 60000);
  app.post(
    "/api/ai/generate",
    authenticated,
    aiLimiter,
    async (request, response) => {
      const input = z
        .object({
          prompt: z.string().trim().min(10).max(8000),
          duration: z.number().int().min(5).max(1440),
          locale: locale.default("fr"),
        })
        .parse(request.body);
      response.json({ blocks: await generateAgenda(config.ai ?? {}, input) });
    },
  );
  app.post(
    "/api/sessions/:id/ai/assist",
    aiLimiter,
    async (request, response) => {
      const input = z
        .object({
          prompt: z.string().trim().min(3).max(8000),
          locale: locale.default("fr"),
        })
        .parse(request.body);
      const { session } = await accessible(
        param(request, "id"),
        user(response).id,
      );
      response.json({
        answer: await assistAgenda(config.ai ?? {}, session, input),
      });
    },
  );
  app.use("/api", createPresenceRouter({ db, accessible, authenticated }));
  await installContentApi(app, {
    db,
    accessible,
    authenticated,
    rateLimits: config.rateLimits,
    quotas: publicQuotas(config.quotas),
  });
  await installAiApi(app, {
    db,
    ai: config.ai ?? {},
    accessible,
    authenticated,
    save,
    rateLimits: config.rateLimits,
    workspaceAccess: (id, userId, allowed) =>
      workspaceAccess(db, id, userId, allowed),
  });
  installDocumentApi(app, {
    ai: config.ai ?? {},
    authenticated,
    rateLimits: config.rateLimits,
  });
  installFormAiApi(app, {
    db,
    ai: config.ai ?? {},
    authenticated,
    accessible,
    rateLimits: config.rateLimits,
  });
  await installMcpApi(app, {
    db,
    authenticated,
    accessible,
    save,
    origin: config.origin,
    rateLimits: config.rateLimits,
  });
  await installExportPresets(app, { db, authenticated });
  installExportAi(app, {
    ai: config.ai ?? {},
    authenticated,
    accessible,
    rateLimits: config.rateLimits,
  });
  app.use("/api", (_request, response) =>
    response
      .status(404)
      .json({ error: "Endpoint not found.", code: "NOT_FOUND" }),
  );
  const clientPath = resolve(config.clientPath ?? "dist/client");
  if (existsSync(resolve(clientPath, "index.html"))) {
    app.use(express.static(clientPath, { index: false, maxAge: "1h" }));
    app.get("/{*path}", (_request, response) =>
      response
        .setHeader("Cache-Control", "no-cache")
        .sendFile(resolve(clientPath, "index.html")),
    );
  }
  app.use(
    (
      error: unknown,
      request: Request,
      response: Response,
      _next: express.NextFunction,
    ) => {
      if (error instanceof z.ZodError)
        return void response.status(400).json({
          error: "Some fields are invalid.",
          code: "VALIDATION_ERROR",
          fields: error.issues.slice(0, 10).map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      if (error instanceof HttpError)
        return void response
          .status(error.status)
          .json({ error: error.message, code: error.code });
      if (error instanceof SyntaxError && "body" in error)
        return void response
          .status(400)
          .json({ error: "Invalid JSON body.", code: "INVALID_JSON" });
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "entity.too.large"
      )
        return void response.status(413).json({
          error: "Request body is too large.",
          code: "BODY_TOO_LARGE",
        });
      // The route and the cause, never the query string or the body.
      log.error("Request failed", {
        method: request.method,
        path: request.path.slice(0, 200),
        error: error instanceof Error ? error.name : "UnknownError",
        reason: error instanceof Error ? error.message.slice(0, 200) : null,
      });
      response.status(500).json({
        error: "The request could not be completed.",
        code: "INTERNAL_ERROR",
      });
    },
  );
  // Every module has created its tables: let other starting pods proceed.
  await db.releaseStartupLock?.();
  return {
    app,
    db,
    mail,
    backups,
    logs,
    close: async () => {
      backups.close();
      await logs.close();
      await mail.close();
      await db.close();
    },
  };
}

function isUniqueViolation(error: unknown) {
  return (
    error instanceof Error &&
    (("code" in error && error.code === "23505") ||
      /UNIQUE constraint failed/.test(error.message))
  );
}
