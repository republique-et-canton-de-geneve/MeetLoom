import type { Express, Response } from "express";
import * as oidc from "openid-client";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import { fail, hashPassword, hashToken, rateLimit, token } from "./security.js";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  accountPolicy: "existing" | "invited";
}
type Flow = {
  stateHash: string;
  bindingHash: string;
  nonce: string;
  verifier: string;
  expiresAt: number;
};
export type OidcClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};
export interface OidcAdapter {
  authorize(input: {
    state: string;
    nonce: string;
    verifier: string;
    redirectUri: string;
  }): Promise<string>;
  exchange(input: {
    url: URL;
    state: string;
    nonce: string;
    verifier: string;
  }): Promise<OidcClaims>;
}
/** All signature, issuer, audience, expiry, nonce and PKCE checks are delegated to
 * the maintained OpenID Connect library, never a hand-decoded JWT. */
function createOidcAdapter(config: OidcConfig): OidcAdapter {
  let configuration: Promise<oidc.Configuration> | undefined;
  const get = () =>
    (configuration ??= oidc
      .discovery(
        new URL(config.issuer),
        config.clientId,
        config.clientSecret,
        undefined,
        { timeout: 10 },
      )
      .catch((error) => {
        configuration = undefined;
        throw error;
      }));
  return {
    async authorize({ state, nonce, verifier, redirectUri }) {
      const client = await get();
      return oidc.buildAuthorizationUrl(client, {
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "openid email profile",
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        response_mode: "query",
      }).href;
    },
    async exchange({ url, state, nonce, verifier }) {
      const result = await oidc.authorizationCodeGrant(await get(), url, {
        expectedState: state,
        expectedNonce: nonce,
        pkceCodeVerifier: verifier,
        idTokenExpected: true,
      });
      const claims = result.claims();
      if (!claims) throw new Error("ID token missing");
      return {
        sub: claims.sub,
        email: typeof claims.email === "string" ? claims.email : undefined,
        email_verified: claims.email_verified === true,
        name: typeof claims.name === "string" ? claims.name : undefined,
      };
    },
  };
}

export async function installOidcApi(
  app: Express,
  {
    db,
    config,
    origin,
    secureCookie,
    issueAuth,
    setAuth,
    rateLimits,
    adapter,
    acceptInvite,
  }: {
    db: Database;
    config?: OidcConfig;
    origin?: string;
    secureCookie: boolean;
    issueAuth: (sql: Sql, id: string) => Promise<string>;
    setAuth: (response: Response, raw: string) => void;
    rateLimits?: boolean;
    adapter?: OidcAdapter;
    acceptInvite?: (
      sql: Sql,
      inviteHash: string,
      userId: string,
    ) => Promise<void>;
  },
) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS oidc_identities (issuer TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(issuer,subject),UNIQUE(issuer,user_id))",
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS oidc_flows (state_hash TEXT PRIMARY KEY,binding_hash TEXT NOT NULL,nonce TEXT NOT NULL,verifier TEXT NOT NULL,expires_at BIGINT NOT NULL)",
  );
  if (!config) return;
  if (!origin) throw new Error("APP_ORIGIN is required when OIDC is enabled.");
  const client = adapter ?? createOidcAdapter(config),
    redirectUri = `${origin}/api/auth/oidc/callback`,
    cookieName = secureCookie ? "__Host-meetloom_oidc" : "meetloom_oidc",
    cookieOptions = {
      httpOnly: true,
      secure: secureCookie,
      sameSite: "lax" as const,
      path: "/",
    };
  const limiter = rateLimits === false ? [] : [rateLimit(20, 15 * 60 * 1000)];
  app.post("/api/auth/oidc/start", ...limiter, async (_request, response) => {
    if (!(await db.all("SELECT id FROM bootstrap WHERE id=1")).length)
      fail(
        403,
        "OIDC_UNAVAILABLE",
        "Initialize the application before enabling sign-in.",
      );
    const state = token(),
      binding = token(),
      nonce = token(),
      verifier = oidc.randomPKCECodeVerifier();
    const url = await client
      .authorize({ state, nonce, verifier, redirectUri })
      .catch(() =>
        fail(
          503,
          "OIDC_UNAVAILABLE",
          "The identity provider is temporarily unavailable.",
        ),
      );
    await db.transaction(async (sql) => {
      await sql.run("DELETE FROM oidc_flows WHERE expires_at<=$1", [
        Date.now(),
      ]);
      const [{ count }] = await sql.all<{ count: string | number }>(
        "SELECT COUNT(*) AS count FROM oidc_flows",
      );
      if (Number(count) >= 2000)
        fail(429, "RATE_LIMITED", "Too many pending sign-ins.");
      await sql.run(
        "INSERT INTO oidc_flows(state_hash,binding_hash,nonce,verifier,expires_at) VALUES($1,$2,$3,$4,$5)",
        [
          hashToken(state),
          hashToken(binding),
          nonce,
          verifier,
          Date.now() + 10 * 60 * 1000,
        ],
      );
    });
    response.cookie(cookieName, binding, {
      ...cookieOptions,
      maxAge: 10 * 60 * 1000,
    });
    response.json({ url });
  });
  app.get("/api/auth/oidc/callback", ...limiter, async (request, response) => {
    response.clearCookie(cookieName, cookieOptions);
    try {
      const state = z
          .string()
          .regex(/^[A-Za-z0-9_-]{43}$/)
          .parse(request.query.state),
        binding = (request.get("Cookie") ?? "")
          .split(";")
          .map((part) => part.trim())
          .find((part) => part.startsWith(`${cookieName}=`))
          ?.slice(cookieName.length + 1);
      if (
        !binding ||
        !/^[A-Za-z0-9_-]{43}$/.test(binding) ||
        request.originalUrl.length > 12000
      )
        throw new Error("Invalid callback");
      const flow = await db.transaction(async (sql) => {
        const [row] = await sql.all<Flow>(
          'SELECT state_hash AS "stateHash",binding_hash AS "bindingHash",nonce,verifier,expires_at AS "expiresAt" FROM oidc_flows WHERE state_hash=$1 AND binding_hash=$2 AND expires_at>$3',
          [hashToken(state), hashToken(binding), Date.now()],
        );
        if (
          !row ||
          !(await sql.run(
            "DELETE FROM oidc_flows WHERE state_hash=$1 AND binding_hash=$2 AND expires_at>$3",
            [hashToken(state), hashToken(binding), Date.now()],
          ))
        )
          throw new Error("Invalid callback");
        return row;
      });
      const callback = new URL(redirectUri);
      callback.search = request.originalUrl.includes("?")
        ? request.originalUrl.slice(request.originalUrl.indexOf("?"))
        : "";
      const claims = await client.exchange({
        url: callback,
        state,
        nonce: flow.nonce,
        verifier: flow.verifier,
      });
      if (!claims.sub || claims.sub.length > 255)
        throw new Error("Invalid subject");
      const now = new Date().toISOString();
      // Random local password is deliberately unknowable for accounts created
      // through an invitation; recovery can later establish a local password.
      const randomPassword = await hashPassword(token());
      const raw = await db.transaction(async (sql) => {
        // Serialize first identity binding and invite consumption across PostgreSQL requests.
        await sql.run("UPDATE bootstrap SET id=id WHERE id=1");
        const [identity] = await sql.all<{ user_id: string }>(
          "SELECT user_id FROM oidc_identities WHERE issuer=$1 AND subject=$2",
          [config.issuer, claims.sub],
        );
        let userId = identity?.user_id;
        if (!userId) {
          if (claims.email_verified !== true || !claims.email)
            throw new Error("Verified email required");
          const email = z.email().max(254).parse(claims.email).toLowerCase();
          const [existing] = await sql.all<{ id: string }>(
            "SELECT id FROM users WHERE email=$1",
            [email],
          );
          userId = existing?.id;
          if (!userId) {
            if (config.accountPolicy !== "invited")
              throw new Error("Account invitation required");
            const [invite] = await sql.all<{
              token_hash: string;
              name: string;
            }>(
              "SELECT token_hash,name FROM invites WHERE email=$1 AND expires_at>$2 ORDER BY expires_at DESC LIMIT 1",
              [email, Date.now()],
            );
            if (
              !invite ||
              !(await sql.run(
                "DELETE FROM invites WHERE token_hash=$1 AND expires_at>$2",
                [invite.token_hash, Date.now()],
              ))
            )
              throw new Error("Account invitation required");
            userId = randomUUID();
            const displayName = (
              claims.name?.trim() ||
              invite.name ||
              email
            ).slice(0, 120);
            await sql.run(
              "INSERT INTO users(id,email,name,locale,password,is_admin,created_at) VALUES($1,$2,$3,$4,$5,0,$6)",
              [userId, email, displayName, "fr", randomPassword, now],
            );
            if (acceptInvite)
              await acceptInvite(sql, invite.token_hash, userId);
          }
          if (
            (
              await sql.all(
                "SELECT user_id FROM account_disabled WHERE user_id=$1",
                [userId],
              )
            ).length
          )
            throw new Error("Disabled account");
          // A changed subject cannot seize an already linked account via a
          // recycled email address at the provider.
          if (
            (
              await sql.all(
                "SELECT subject FROM oidc_identities WHERE issuer=$1 AND user_id=$2",
                [config.issuer, userId],
              )
            ).length
          )
            throw new Error("Identity is already bound");
          await sql.run(
            "INSERT INTO oidc_identities(issuer,subject,user_id,created_at) VALUES($1,$2,$3,$4)",
            [config.issuer, claims.sub, userId, now],
          );
        }
        return issueAuth(sql, userId);
      });
      setAuth(response, raw);
      response.redirect(303, "/");
    } catch {
      response.redirect(303, "/?authError=OIDC_FAILED");
    }
  });
}
