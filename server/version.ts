import { readFileSync } from "node:fs";

export interface AppVersion {
  /** Release version, e.g. `0.2.0` or `0.2.0-rc.1`. */
  version: string;
  /** Git commit the image was built from, when the build recorded it. */
  revision: string | null;
}

/**
 * The version this process runs. Release images set `APP_VERSION` and
 * `APP_REVISION` at build time (release candidates carry their `-rc.N`,
 * which `package.json` does not); other builds fall back to `package.json`.
 */
export function appVersion(env: NodeJS.ProcessEnv = process.env): AppVersion {
  const version = env.APP_VERSION?.trim() ?? "";
  const revision = env.APP_REVISION?.trim() ?? "";
  return {
    version: /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]{1,40})?$/.test(version)
      ? version
      : packageVersion(),
    revision: /^[0-9a-f]{7,40}$/i.test(revision) ? revision : null,
  };
}

function packageVersion(): string {
  // server/version.ts in development, dist/server/version.js when built.
  for (const path of ["../package.json", "../../package.json"]) {
    try {
      const manifest = JSON.parse(
        readFileSync(new URL(path, import.meta.url), "utf8"),
      ) as { name?: string; version?: string };
      if (manifest.name === "meetloom" && manifest.version)
        return manifest.version;
    } catch {
      // Not at this depth: try the next one.
    }
  }
  return "unknown";
}
