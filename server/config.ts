import type { AppConfig } from "./app.js";
import { z } from "zod";

function boolean(env: NodeJS.ProcessEnv, key: string, fallback: boolean) {
  const value = env[key];
  if (value === undefined || value === "") return fallback;
  if (value !== "true" && value !== "false")
    throw new Error(`${key} must be true or false.`);
  return value === "true";
}
function integer(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const input = env[key];
  if (input === undefined || input === "") return fallback;
  const value = Number(input);
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${key} must be an integer between ${min} and ${max}.`);
  return value;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  // Render supplies its public URL; an explicit APP_ORIGIN (custom domain) wins.
  const suppliedOrigin = (
    env.APP_ORIGIN ||
    env.PUBLIC_ORIGIN ||
    env.RENDER_EXTERNAL_URL
  )?.trim();
  if (production && !suppliedOrigin)
    throw new Error("APP_ORIGIN is required in production.");
  let origin: string | undefined;
  if (suppliedOrigin) {
    let url: URL;
    try {
      url = new URL(suppliedOrigin);
    } catch {
      throw new Error("APP_ORIGIN must be an HTTP(S) origin.");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error(
        "APP_ORIGIN must contain only an HTTP(S) scheme, hostname and optional port.",
      );
    origin = url.origin;
  }
  const app: AppConfig = {
    databaseUrl: env.DATABASE_URL || undefined,
    sqlitePath: env.SQLITE_PATH || undefined,
    origin,
    secureCookie: boolean(env, "COOKIE_SECURE", production),
    trustProxy: integer(env, "TRUST_PROXY", 0, 0, 10),
    bootstrapToken: env.BOOTSTRAP_TOKEN?.trim() || undefined,
    backups: {
      scheduler: boolean(env, "BACKUP_SCHEDULER", true),
      maxArchiveBytes:
        integer(env, "DATA_ARCHIVE_MAX_MB", 100, 1, 2048) * 1024 * 1024,
    },
    ai: {
      baseUrl: env.LLM_BASE_URL?.trim() || undefined,
      model: env.LLM_MODEL?.trim() || undefined,
      visionModel: env.LLM_VISION_MODEL?.trim() || undefined,
      apiKey: env.LLM_API_KEY || undefined,
      timeoutMs: integer(env, "AI_TIMEOUT_MS", 30000, 100, 300000),
      maxResponseBytes: integer(
        env,
        "AI_MAX_RESPONSE_BYTES",
        100000,
        1024,
        1000000,
      ),
    },
  };
  if (env.OIDC_ISSUER || env.OIDC_CLIENT_ID || env.OIDC_CLIENT_SECRET) {
    if (!origin)
      throw new Error("APP_ORIGIN is required when OIDC is enabled.");
    let issuer: URL;
    try {
      issuer = new URL(env.OIDC_ISSUER ?? "");
    } catch {
      throw new Error("OIDC_ISSUER must be an HTTPS issuer URL.");
    }
    if (
      issuer.protocol !== "https:" ||
      issuer.username ||
      issuer.password ||
      issuer.search ||
      issuer.hash
    )
      throw new Error(
        "OIDC_ISSUER must be an HTTPS issuer URL without credentials or query.",
      );
    if (!env.OIDC_CLIENT_ID?.trim() || !env.OIDC_CLIENT_SECRET)
      throw new Error("OIDC_CLIENT_ID and OIDC_CLIENT_SECRET are required.");
    const policy = env.OIDC_ACCOUNT_POLICY || "existing";
    if (policy !== "existing" && policy !== "invited")
      throw new Error("OIDC_ACCOUNT_POLICY must be existing or invited.");
    app.oidc = {
      issuer: issuer.href,
      clientId: env.OIDC_CLIENT_ID.trim(),
      clientSecret: env.OIDC_CLIENT_SECRET,
      accountPolicy: policy,
    };
  }
  if (env.SMTP_HOST || env.SMTP_FROM || env.SMTP_USER || env.SMTP_PASSWORD) {
    if (!origin)
      throw new Error("APP_ORIGIN is required when SMTP is enabled.");
    const host = env.SMTP_HOST?.trim();
    if (!host || host.length > 253 || /[\s/:@]/u.test(host))
      throw new Error("SMTP_HOST must be a hostname.");
    const from = z.email().safeParse(env.SMTP_FROM?.trim());
    if (!from.success)
      throw new Error("SMTP_FROM must be a valid email address.");
    if (!!env.SMTP_USER !== !!env.SMTP_PASSWORD)
      throw new Error("SMTP_USER and SMTP_PASSWORD must be supplied together.");
    app.mail = {
      host,
      port: integer(env, "SMTP_PORT", 587, 1, 65535),
      secure: boolean(env, "SMTP_SECURE", false),
      user: env.SMTP_USER || undefined,
      password: env.SMTP_PASSWORD || undefined,
      from: from.data,
      scheduled: boolean(env, "SMTP_SCHEDULED", true),
    };
  }
  if (production && (app.oidc || app.mail) && !origin?.startsWith("https://"))
    throw new Error(
      "APP_ORIGIN must use HTTPS for production authentication and mail services.",
    );
  if (production && app.oidc && !app.secureCookie)
    throw new Error("COOKIE_SECURE must be true for production OIDC.");
  return {
    app,
    production,
    port: integer(env, "PORT", 3000, 0, 65535),
    host: env.HOST || "0.0.0.0",
  };
}
