import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Database } from "./db.js";

/**
 * A random key per installation, stored in `installation_keys`. That table is
 * never exported and survives restores and imports, so what it seals (visitor
 * link addresses) can be read again here but not from an export, a downloaded
 * backup, or another environment the data was imported into. It does not
 * protect against someone reading this database directly, who can already
 * read every session.
 */
export async function installationKey(
  db: Database,
  purpose: string,
): Promise<Buffer> {
  await db.run(
    "CREATE TABLE IF NOT EXISTS installation_keys (purpose TEXT PRIMARY KEY, key TEXT NOT NULL, created_at TEXT NOT NULL)",
  );
  // Several pods may start at once: the first insert wins, all read it back.
  await db.run(
    "INSERT INTO installation_keys(purpose,key,created_at) VALUES($1,$2,$3) ON CONFLICT(purpose) DO NOTHING",
    [purpose, randomBytes(32).toString("base64"), new Date().toISOString()],
  );
  const [row] = await db.all<{ key: string }>(
    "SELECT key FROM installation_keys WHERE purpose=$1",
    [purpose],
  );
  return Buffer.from(row.key, "base64");
}

/** AES-256-GCM, bound to `context` (a row id) so a value cannot be moved to
 * another row. */
export function seal(key: Buffer, value: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url")}`;
}

/** The sealed value, or null when it was sealed by another installation. */
export function unseal(
  key: Buffer,
  sealed: string,
  context: string,
): string | null {
  if (!sealed.startsWith("v1.")) return null;
  const raw = Buffer.from(sealed.slice(3), "base64url");
  if (raw.length < 29) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([
      decipher.update(raw.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
