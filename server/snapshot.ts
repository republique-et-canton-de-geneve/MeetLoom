import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Database, Sql } from "./db.js";
import type { AppVersion } from "./version.js";

/**
 * Every table holding durable data, parents before children: a snapshot is
 * inserted in this order and deleted in reverse. A closed list, like the audit
 * actions: `tests/snapshot.test.ts` fails when a table exists in neither this
 * list nor `TRANSIENT_TABLES`, so a new table is never silently left out of
 * exports and backups.
 */
export const SNAPSHOT_TABLES = [
  "users",
  "bootstrap",
  "workspaces",
  "app_settings",
  "folder_scopes",
  "folders",
  "account_disabled",
  "account_profiles",
  "oidc_identities",
  "invites",
  "mcp_tokens",
  "ai_preferences",
  "ai_instruction_sets",
  "export_presets",
  "mail_digest_state",
  "workspace_members",
  "workspace_invitations",
  "sessions",
  "session_workspaces",
  "session_lifecycle",
  "session_people",
  "session_views",
  "members",
  "shares",
  "share_options",
  "versions",
  "version_metadata",
  "session_journal",
  "deleted_elements",
  "comments",
  "comment_threads",
  "comment_context",
  "notifications",
  "visitor_comments",
  "form_publications",
  "form_publication_usage",
  "form_responses",
  "form_response_images",
  "ai_conversations",
  "ai_messages",
  "audit_events",
] as const;

/** Tied to one running environment (sign-ins, one-time links, presence, the
 * outgoing mail queue) or to the backups themselves: never exported, and
 * emptied when a snapshot replaces the data, which signs everyone out. */
export const TRANSIENT_TABLES = [
  "auth_sessions",
  "account_resets",
  "oidc_flows",
  "presence_heartbeats",
  "share_activity",
  "mail_deliveries",
  "mail_recovery_requests",
] as const;
/** Kept across a restore or an import, so both can be undone. */
export const PRESERVED_TABLES = ["app_backups", "backup_schedule"] as const;

export interface Snapshot {
  format: "meetloom-data";
  formatVersion: 1;
  createdAt: string;
  app: AppVersion;
  tables: Record<string, { columns: string[]; rows: unknown[][] }>;
}

export class SnapshotError extends Error {
  constructor(
    readonly code:
      | "ARCHIVE_INVALID"
      | "ARCHIVE_PASSPHRASE"
      | "ARCHIVE_TOO_LARGE"
      | "ARCHIVE_INCOMPATIBLE",
    message: string,
  ) {
    super(message);
  }
}

type Dialect = "sqlite" | "postgres";
export async function dialectOf(db: Sql): Promise<Dialect> {
  try {
    await db.all("SELECT sqlite_version() AS version");
    return "sqlite";
  } catch {
    return "postgres";
  }
}

/** Never emptied: a restore or an import adds the archive's rows to the
 * ones already there, so the trail of who did what (the restore included)
 * survives it. */
const APPEND_ONLY_TABLES = new Set<string>(["audit_events"]);

/** Tables present in the database, for the coverage test and for imports. */
export async function listTables(db: Sql, dialect: Dialect) {
  const rows =
    dialect === "sqlite"
      ? await db.all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
      : await db.all<{ name: string }>(
          "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_type='BASE TABLE'",
        );
  return rows.map((row) => row.name).sort();
}

async function columnsOf(sql: Sql, dialect: Dialect, table: string) {
  const rows =
    dialect === "sqlite"
      ? await sql.all<{ name: string }>(`PRAGMA table_info(${table})`)
      : await sql.all<{ name: string }>(
          "SELECT column_name AS name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position",
          [table],
        );
  return rows.map((row) => row.name);
}

/** Reads every durable table in one transaction, so the copy is consistent. */
export async function takeSnapshot(
  db: Database,
  app: AppVersion,
): Promise<Snapshot> {
  const dialect = await dialectOf(db);
  return db.transaction(async (sql) => {
    // PostgreSQL otherwise lets each SELECT see newer commits: one snapshot
    // for the whole read keeps sessions, versions and comments consistent.
    if (dialect === "postgres")
      await sql.run("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const tables: Snapshot["tables"] = {};
    for (const table of SNAPSHOT_TABLES) {
      const columns = await columnsOf(sql, dialect, table);
      if (!columns.length) continue;
      const rows = await sql.all<Record<string, unknown>>(
        `SELECT ${columns.join(",")} FROM ${table}`,
      );
      tables[table] = {
        columns,
        rows: rows.map((row) => columns.map((column) => row[column] ?? null)),
      };
    }
    return {
      format: "meetloom-data",
      formatVersion: 1,
      createdAt: new Date().toISOString(),
      app,
      tables,
    };
  });
}

/** Counts shown next to a snapshot, without keeping it in memory. */
export const snapshotSummary = (snapshot: Snapshot) => ({
  sessions: snapshot.tables.sessions?.rows.length ?? 0,
  accounts: snapshot.tables.users?.rows.length ?? 0,
});

/**
 * Replaces all durable data with a snapshot, in the caller's transaction: it
 * commits whole or not at all. Columns are matched by name, so a snapshot
 * from an older version (fewer columns or tables) loads; one with a column
 * this version does not know is refused rather than silently truncated.
 */
export async function replaceWithSnapshot(
  sql: Sql,
  dialect: Dialect,
  snapshot: Snapshot,
) {
  const known = new Set<string>(SNAPSHOT_TABLES);
  for (const table of Object.keys(snapshot.tables))
    if (!known.has(table))
      throw new SnapshotError(
        "ARCHIVE_INCOMPATIBLE",
        `This archive contains data (${table}) that this version does not know. Update MeetLoom first.`,
      );
  // Other pods keep serving requests: block their writes until the new data
  // is committed, so none lands half in the old data and half in the new.
  if (dialect === "postgres")
    await sql.run(
      `LOCK TABLE ${[...SNAPSHOT_TABLES, ...TRANSIENT_TABLES].join(",")} IN EXCLUSIVE MODE`,
    );
  for (const table of TRANSIENT_TABLES) await sql.run(`DELETE FROM ${table}`);
  for (const table of [...SNAPSHOT_TABLES].reverse())
    if (!APPEND_ONLY_TABLES.has(table)) await sql.run(`DELETE FROM ${table}`);
  for (const table of SNAPSHOT_TABLES) {
    const data = snapshot.tables[table];
    if (!data?.rows.length) continue;
    const target = new Set(await columnsOf(sql, dialect, table));
    const unknown = data.columns.filter((column) => !target.has(column));
    if (unknown.length)
      throw new SnapshotError(
        "ARCHIVE_INCOMPATIBLE",
        `This archive has columns this version does not know (${table}.${unknown[0]}). Update MeetLoom first.`,
      );
    // Several rows per statement, within both databases' parameter limits.
    const perStatement = Math.max(1, Math.floor(2000 / data.columns.length));
    for (let start = 0; start < data.rows.length; start += perStatement) {
      const rows = data.rows.slice(start, start + perStatement);
      const values: unknown[] = [];
      const tuples = rows.map((row) => {
        if (!Array.isArray(row) || row.length !== data.columns.length)
          throw new SnapshotError("ARCHIVE_INVALID", "Malformed archive row.");
        return `(${row
          .map((value) => {
            values.push(value);
            return `$${values.length}`;
          })
          .join(",")})`;
      });
      await sql.run(
        `INSERT INTO ${table}(${data.columns.join(",")}) VALUES ${tuples.join(",")}${
          APPEND_ONLY_TABLES.has(table) ? " ON CONFLICT DO NOTHING" : ""
        }`,
        values,
      );
    }
  }
}

// ── Archives: gzip, then AES-256-GCM with a key derived from a passphrase.
const MAGIC = Buffer.from("MLDX");
const FORMAT = 1;
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export const PASSPHRASE_MIN = 12;

const deriveKey = (passphrase: string, salt: Buffer) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(passphrase, salt, 32, SCRYPT, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

export const compress = (snapshot: Snapshot) =>
  gzipSync(Buffer.from(JSON.stringify(snapshot), "utf8"));

/** Decompresses and validates, refusing anything above `maxBytes` once
 * inflated (a small archive can expand enormously). */
export function decompress(data: Buffer, maxBytes: number): Snapshot {
  let json: Buffer;
  try {
    json = gunzipSync(data, { maxOutputLength: maxBytes });
  } catch (error) {
    if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE")
      throw new SnapshotError(
        "ARCHIVE_TOO_LARGE",
        "This archive is larger than this installation accepts.",
      );
    throw new SnapshotError(
      "ARCHIVE_INVALID",
      "This is not a MeetLoom archive.",
    );
  }
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(json.toString("utf8")) as Snapshot;
  } catch {
    throw new SnapshotError(
      "ARCHIVE_INVALID",
      "This is not a MeetLoom archive.",
    );
  }
  if (
    snapshot?.format !== "meetloom-data" ||
    snapshot.formatVersion !== 1 ||
    typeof snapshot.tables !== "object" ||
    snapshot.tables === null ||
    Object.values(snapshot.tables).some(
      (table) =>
        !Array.isArray(table?.columns) ||
        !Array.isArray(table.rows) ||
        table.columns.some((column) => !/^[a-z_][a-z0-9_]*$/.test(column)),
    )
  )
    throw new SnapshotError(
      "ARCHIVE_INVALID",
      "This is not a MeetLoom archive.",
    );
  return snapshot;
}

export async function encrypt(plain: Buffer, passphrase: string) {
  const salt = randomBytes(16),
    iv = randomBytes(12);
  const header = Buffer.concat([MAGIC, Buffer.from([FORMAT]), salt]);
  const cipher = createCipheriv(
    "aes-256-gcm",
    await deriveKey(passphrase, salt),
    iv,
  );
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([header, iv, body, cipher.getAuthTag()]);
}

export async function decrypt(archive: Buffer, passphrase: string) {
  if (
    archive.length < 4 + 1 + 16 + 12 + 16 ||
    !archive.subarray(0, 4).equals(MAGIC) ||
    archive[4] !== FORMAT
  )
    throw new SnapshotError(
      "ARCHIVE_INVALID",
      "This is not a MeetLoom archive.",
    );
  const header = archive.subarray(0, 21),
    salt = archive.subarray(5, 21),
    iv = archive.subarray(21, 33),
    tag = archive.subarray(archive.length - 16),
    body = archive.subarray(33, archive.length - 16);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await deriveKey(passphrase, salt),
    iv,
  );
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    // Wrong passphrase and tampering are indistinguishable, by design.
    throw new SnapshotError(
      "ARCHIVE_PASSPHRASE",
      "Wrong passphrase, or the archive was modified.",
    );
  }
}
