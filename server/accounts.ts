import type { Express, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import { removeAccountMembership } from "./workspaces.js";
import { audit } from "./audit.js";
import {
  accountPreferencesSchema,
  DEFAULT_ACCOUNT_PREFERENCES,
  type AccountProfile,
} from "../shared/accounts.js";
import type { Session, User } from "../shared/model.js";
import {
  fail,
  hashPassword,
  hashToken,
  token,
  verifyPassword,
  rateLimit,
} from "./security.js";

const id = z.string().min(1).max(120),
  email = z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase().trim()),
  password = z.string().min(12).max(256);
const who = (response: Response) => response.locals.user as User;
export async function accountProfile(
  db: Sql,
  userId: string,
): Promise<AccountProfile> {
  const [row] = await db.all<{ payload: string }>(
    "SELECT payload FROM account_profiles WHERE user_id=$1",
    [userId],
  );
  return row
    ? JSON.parse(row.payload)
    : { preferences: { ...DEFAULT_ACCOUNT_PREFERENCES } };
}
export async function installAccountsApi(
  app: Express,
  {
    db,
    authenticated,
    admin,
    issueAuth,
    setAuth,
    rateLimits,
  }: {
    db: Database;
    authenticated: RequestHandler;
    admin: RequestHandler;
    issueAuth: (sql: Sql, id: string) => Promise<string>;
    setAuth: (res: Response, raw: string) => void;
    rateLimits?: boolean;
  },
) {
  // Mount after authentication: changing email and deleting the account share
  // one password-verification budget, even across different client IPs.
  const credentialLimiter: RequestHandler =
    rateLimits === false
      ? (_request, _response, next) => next()
      : rateLimit(
          20,
          15 * 60 * 1000,
          (_request, response) => `account:${who(response).id}`,
        );
  await db.transaction(async (sql) => {
    await sql.run(
      "CREATE TABLE IF NOT EXISTS account_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL)",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS account_disabled(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,disabled_at TEXT NOT NULL)",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS account_resets(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at BIGINT NOT NULL)",
    );
  });
  app.get("/api/account", authenticated, async (_req, res) =>
    res.json({
      user: who(res),
      profile: await accountProfile(db, who(res).id),
    }),
  );
  app.put(
    "/api/account",
    authenticated,
    credentialLimiter,
    async (req, res) => {
      const input = z
        .object({
          name: z.string().trim().min(1).max(120),
          email,
          locale: z.enum(["fr", "en"]),
          currentPassword: z.string().max(256).optional(),
          avatar: z
            .string()
            .max(120000)
            .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/)
            .optional(),
          preferences: accountPreferencesSchema,
        })
        .strict()
        .parse(req.body);
      const [user] = await db.all<{ password: string; email: string }>(
        "SELECT password,email FROM users WHERE id=$1",
        [who(res).id],
      );
      if (
        input.email !== user.email &&
        !(await verifyPassword(input.currentPassword ?? "", user.password))
      )
        return fail(
          401,
          "INVALID_CREDENTIALS",
          "Confirm the current password to change your email.",
        );
      if (
        input.email !== user.email &&
        (await db.all("SELECT id FROM users WHERE email=$1", [input.email]))
          .length
      )
        return fail(
          409,
          "ACCOUNT_EXISTS",
          "An account already exists for this email.",
        );
      const profile: AccountProfile = {
        ...(input.avatar ? { avatar: input.avatar } : {}),
        preferences: input.preferences,
      };
      await db.transaction(async (sql) => {
        if (
          !(await sql.run(
            "UPDATE users SET name=$1,email=$2,locale=$3 WHERE id=$4 AND password=$5 AND email=$6 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
            [
              input.name,
              input.email,
              input.locale,
              who(res).id,
              user.password,
              user.email,
            ],
          ))
        )
          return fail(
            409,
            "ACCOUNT_CHANGED",
            "Your account changed. Reload before saving.",
          );
        // Recovery links issued to an earlier email address no longer establish
        // ownership after the account's address changes.
        if (input.email !== user.email)
          await sql.run("DELETE FROM account_resets WHERE user_id=$1", [
            who(res).id,
          ]);
        await sql.run(
          "INSERT INTO account_profiles(user_id,payload) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload",
          [who(res).id, JSON.stringify(profile)],
        );
      });
      res.json({
        user: {
          ...who(res),
          name: input.name,
          email: input.email,
          locale: input.locale,
          avatar: input.avatar,
        },
        profile,
      });
    },
  );
  app.get("/api/admin/accounts", admin, async (_req, res) => {
    const users = await db.all<{
      id: string;
      name: string;
      email: string;
      isAdmin: number;
      disabled: number;
    }>(
      'SELECT u.id,u.name,u.email,u.is_admin AS "isAdmin",CASE WHEN d.user_id IS NULL THEN 0 ELSE 1 END AS disabled FROM users u LEFT JOIN account_disabled d ON d.user_id=u.id ORDER BY u.name',
    );
    res.json({
      users: users.map((user) => ({
        ...user,
        isAdmin: !!user.isAdmin,
        disabled: !!user.disabled,
      })),
    });
  });
  app.get("/api/admin/accounts/:id/access", admin, async (req, res) => {
    const rows = await db.all<{ id: string; payload: string; role: string }>(
      "SELECT s.id,s.payload,CASE WHEN s.owner_id=$1 THEN 'owner' ELSE m.role END AS role FROM sessions s LEFT JOIN members m ON m.session_id=s.id AND m.user_id=$1 WHERE s.owner_id=$1 OR m.user_id=$1",
      [id.parse(req.params.id)],
    );
    res.json({
      sessions: rows.map((row) => ({
        id: row.id,
        title: (JSON.parse(row.payload) as Session).title,
        role: row.role,
      })),
    });
  });
  app.patch("/api/admin/accounts/:id", admin, async (req, res) => {
    const userId = id.parse(req.params.id),
      input = z
        .object({
          isAdmin: z.boolean().optional(),
          disabled: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
    if (
      userId === who(res).id &&
      (input.disabled === true || input.isAdmin === false)
    )
      return fail(
        400,
        "SELF_ADMIN_PROTECTED",
        "Another administrator must change your administrator access.",
      );
    if (!(await db.all("SELECT id FROM users WHERE id=$1", [userId])).length)
      return fail(404, "NOT_FOUND", "Account not found.");
    await db.transaction(async (sql) => {
      await sql.run("UPDATE bootstrap SET id=id WHERE id=1");
      if (
        !(
          await sql.all(
            "SELECT id FROM users WHERE id=$1 AND is_admin=1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
            [who(res).id],
          )
        ).length
      )
        return fail(
          403,
          "FORBIDDEN",
          "Active administrator access is required.",
        );
      if (input.disabled === true) {
        const administered = await sql.all<{ workspace_id: string }>(
          "SELECT workspace_id FROM workspace_members WHERE user_id=$1 AND role='admin' ORDER BY workspace_id",
          [userId],
        );
        for (const membership of administered) {
          await sql.run("UPDATE workspaces SET version=version WHERE id=$1", [
            membership.workspace_id,
          ]);
          if (
            !(
              await sql.all(
                "SELECT m.user_id FROM workspace_members m WHERE m.workspace_id=$1 AND m.role='admin' AND m.user_id<>$2 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=m.user_id)",
                [membership.workspace_id, userId],
              )
            ).length
          )
            return fail(
              409,
              "LAST_WORKSPACE_ADMIN",
              "Appoint another active workspace administrator before disabling this account.",
            );
        }
      }
      if (input.isAdmin !== undefined)
        await sql.run("UPDATE users SET is_admin=$1 WHERE id=$2", [
          input.isAdmin ? 1 : 0,
          userId,
        ]);
      if (input.disabled === true) {
        await sql.run(
          "INSERT INTO account_disabled(user_id,disabled_at) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING",
          [userId, new Date().toISOString()],
        );
        await sql.run("DELETE FROM auth_sessions WHERE user_id=$1", [userId]);
        await sql.run("DELETE FROM account_resets WHERE user_id=$1", [userId]);
      } else if (input.disabled === false)
        await sql.run("DELETE FROM account_disabled WHERE user_id=$1", [
          userId,
        ]);
      await audit(sql, req, res, "account.update", {
        target: userId,
        detail: input,
      });
    });
    res.json({ ok: true });
  });
  app.delete("/api/admin/accounts/:id/access", admin, async (req, res) => {
    const userId = id.parse(req.params.id);
    await db.transaction(async (sql) => {
      await removeAccountMembership(sql, userId);
      await sql.run("DELETE FROM members WHERE user_id=$1", [userId]);
      await audit(sql, req, res, "account.access-revoke", { target: userId });
    });
    res.json({ ok: true });
  });
  app.post("/api/admin/accounts/:id/reset", admin, async (req, res) => {
    const userId = id.parse(req.params.id);
    if (
      !(
        await db.all(
          "SELECT id FROM users WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
          [userId],
        )
      ).length
    )
      return fail(404, "NOT_FOUND", "Active account not found.");
    const raw = token(),
      expiresAt = Date.now() + 60 * 60 * 1000;
    await db.transaction(async (sql) => {
      await sql.run(
        "DELETE FROM account_resets WHERE user_id=$1 OR expires_at<=$2",
        [userId, Date.now()],
      );
      await sql.run(
        "INSERT INTO account_resets(token_hash,user_id,expires_at) VALUES($1,$2,$3)",
        [hashToken(raw), userId, expiresAt],
      );
      await audit(sql, req, res, "account.reset", { target: userId });
    });
    res.status(201).json({ token: raw, expiresAt });
  });
  app.post(
    "/api/auth/reset-password",
    ...(rateLimits === false ? [] : [rateLimit(10, 15 * 60 * 1000)]),
    async (req, res) => {
      const input = z
          .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/), password })
          .strict()
          .parse(req.body),
        encoded = await hashPassword(input.password);
      const raw = await db.transaction(async (sql) => {
        const [reset] = await sql.all<{ user_id: string }>(
          "SELECT user_id FROM account_resets WHERE token_hash=$1 AND expires_at>$2",
          [hashToken(input.token), Date.now()],
        );
        if (reset)
          await sql.run("UPDATE users SET id=id WHERE id=$1", [reset.user_id]);
        if (
          !reset ||
          !(await sql.run(
            "DELETE FROM account_resets WHERE token_hash=$1 AND expires_at>$2",
            [hashToken(input.token), Date.now()],
          ))
        )
          return fail(
            400,
            "RESET_INVALID",
            "This recovery link expired or has already been used.",
          );
        if (
          (
            await sql.all(
              "SELECT user_id FROM account_disabled WHERE user_id=$1",
              [reset.user_id],
            )
          ).length
        )
          return fail(
            400,
            "RESET_INVALID",
            "This recovery link expired or has already been used.",
          );
        await sql.run("UPDATE users SET password=$1 WHERE id=$2", [
          encoded,
          reset.user_id,
        ]);
        await sql.run("DELETE FROM auth_sessions WHERE user_id=$1", [
          reset.user_id,
        ]);
        await sql.run("DELETE FROM account_resets WHERE user_id=$1", [
          reset.user_id,
        ]);
        return issueAuth(sql, reset.user_id);
      });
      setAuth(res, raw);
      res.json({ ok: true });
    },
  );
  app.post(
    "/api/account/delete",
    authenticated,
    credentialLimiter,
    async (req, res) => {
      const input = z
          .object({
            currentPassword: z.string().max(256),
            transferTo: id.optional(),
            transferEmail: email.optional(),
          })
          .strict()
          .parse(req.body),
        userId = who(res).id;
      const [user] = await db.all<{ password: string }>(
        "SELECT password FROM users WHERE id=$1",
        [userId],
      );
      if (!(await verifyPassword(input.currentPassword, user.password)))
        return fail(
          401,
          "INVALID_CREDENTIALS",
          "The current password is incorrect.",
        );
      const replacementPassword = await hashPassword(token());
      await db.transaction(async (sql) => {
        // Serialize administrator deletions so at least one usable administrator remains.
        await sql.run("UPDATE bootstrap SET id=id WHERE id=1");
        await sql.run("UPDATE users SET id=id WHERE id=$1", [userId]);
        const [current] = await sql.all<{ password: string; is_admin: number }>(
          "SELECT password,is_admin FROM users WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
          [userId],
        );
        if (!current || current.password !== user.password)
          return fail(
            409,
            "ACCOUNT_CHANGED",
            "Your credentials changed. Sign in again before deleting the account.",
          );
        if (
          current.is_admin &&
          (
            await sql.all(
              "SELECT u.id FROM users u WHERE u.is_admin=1 AND u.id<>$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=u.id)",
              [userId],
            )
          ).length === 0
        )
          return fail(
            400,
            "LAST_ADMIN",
            "Appoint another active administrator before deleting your account.",
          );
        const owned = await sql.all<{
          id: string;
          payload: string;
          version: number;
        }>("SELECT id,payload,version FROM sessions WHERE owner_id=$1", [
          userId,
        ]);
        if (input.transferEmail) {
          const [recipient] = await sql.all<{ id: string }>(
            "SELECT id FROM users WHERE email=$1",
            [input.transferEmail],
          );
          input.transferTo = recipient?.id;
        }
        if (
          owned.length &&
          (!input.transferTo ||
            input.transferTo === userId ||
            !(
              await sql.all(
                "SELECT id FROM users WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=users.id)",
                [input.transferTo],
              )
            ).length)
        )
          return fail(
            400,
            "TRANSFER_REQUIRED",
            "Transfer your sessions to an active account first.",
          );
        for (const row of owned) {
          const session = JSON.parse(row.payload) as Session;
          session.ownerId = input.transferTo!;
          session.version++;
          session.updatedAt = new Date().toISOString();
          if (
            !(await sql.run(
              "UPDATE sessions SET owner_id=$1,payload=$2,version=$3,updated_at=$4 WHERE id=$5 AND version=$6",
              [
                session.ownerId,
                JSON.stringify(session),
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
              "An agenda changed during transfer. Retry.",
            );
          await sql.run(
            "DELETE FROM members WHERE session_id=$1 AND user_id=$2",
            [row.id, input.transferTo],
          );
        }
        await removeAccountMembership(sql, userId, input.transferTo);
        await sql.run("DELETE FROM members WHERE user_id=$1", [userId]);
        await sql.run("DELETE FROM auth_sessions WHERE user_id=$1", [userId]);
        await sql.run("DELETE FROM account_profiles WHERE user_id=$1", [
          userId,
        ]);
        await sql.run("DELETE FROM account_resets WHERE user_id=$1", [userId]);
        await sql.run("DELETE FROM folder_scopes WHERE id=$1", [
          `user:${userId}`,
        ]);
        await sql.run(
          "UPDATE users SET name=$1,email=$2,password=$3,is_admin=0 WHERE id=$4",
          [
            "Deleted user",
            `deleted-${randomUUID()}@invalid.local`,
            replacementPassword,
            userId,
          ],
        );
        await sql.run(
          "INSERT INTO account_disabled(user_id,disabled_at) VALUES($1,$2) ON CONFLICT(user_id) DO NOTHING",
          [userId, new Date().toISOString()],
        );
      });
      res.json({ ok: true });
    },
  );
}
