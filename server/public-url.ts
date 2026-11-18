import type { Request } from "express";

export interface PublicUrlConfig {
  origin?: string;
  /** Alternate external URL. The reverse proxy strips its path prefix. */
  publicUrl?: string;
}

export function parsePublicUrl(value: string) {
  const invalid = () =>
    new Error(
      "APP_PUBLIC_URL must be an HTTP(S) URL with a simple path and no credentials, query or fragment.",
    );
  if (!/^https?:\/\/[^/]+(?:\/[A-Za-z0-9_-]+)*\/?$/.test(value))
    throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (url.username || url.password || url.search || url.hash) throw invalid();
  return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
}

/** Host selects only an operator-configured URL. Forwarded headers never
 * become a trusted URL or path. Probes and native requests keep the root. */
export function publicAccess(request: Request, config: PublicUrlConfig) {
  const alternate = config.publicUrl ? new URL(config.publicUrl) : undefined;
  if (
    alternate &&
    request.get("host")?.toLowerCase() === alternate.host.toLowerCase()
  )
    return {
      origin: alternate.origin,
      basePath: alternate.pathname.replace(/\/$/, ""),
    };
  return {
    origin: config.origin ?? `${request.protocol}://${request.get("host")}`,
    basePath: "",
  };
}

export function appCookie(
  request: Request,
  config: PublicUrlConfig,
  secure: boolean,
  purpose: "session" | "oidc",
) {
  const basePath = publicAccess(request, config).basePath;
  return {
    name: `${secure ? (basePath ? "__Secure-" : "__Host-") : ""}meetloom_${purpose}`,
    options: {
      httpOnly: true,
      secure,
      sameSite: purpose === "oidc" ? ("lax" as const) : ("strict" as const),
      path: `${basePath}/`,
    },
  };
}
