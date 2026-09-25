import { randomUUID } from "node:crypto";
import express, {
  type Express,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { z } from "zod";
import type { Database, Sql } from "./db.js";
import { audit } from "./audit.js";
import { fail, rateLimit, verifyPassword } from "./security.js";
import { storedSession } from "./workspaces.js";
import { localDate } from "../shared/domain.js";
import { INITIAL_RUN, type Session, type User } from "../shared/model.js";
import type { AppVersion } from "./version.js";
import {
  PASSPHRASE_MIN,
  SnapshotError,
  compress,
  decompress,
  decrypt,
  dialectOf,
  encrypt,
  replaceWithSnapshot,
  snapshotSummary,
  takeSnapshot,
  type Snapshot,
} from "./snapshot.js";
import { log } from "./log.js";

/**
 * Application-level backups and data transfer, for administrators.
 *
 * Backups are snapshots stored in the database itself (table `app_backups`),
 * like RetroGemini: they work with several pods and need no extra volume, and
 * they undo mistakes (a session deleted too early, an import over the wrong
 * environment). They do not replace backups of the PostgreSQL volume, which
 * protect against losing the database itself (docs/operations.md).
 */
export interface BackupConfig {
  /** Runs scheduled backups; off in tests unless asked for. */
  scheduler?: boolean;
  /** Largest archive accepted once decompressed, in bytes. */
  maxArchiveBytes?: number;
}
export const DEFAULT_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const MANUAL_LIMIT = 50;
const SAFETY_KEPT = 5;

const scheduleSchema = z
  .object({
    mode: z.enum(["off", "daily", "twice"]),
    times: z
      .array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/))
      .min(1)
      .max(2),
    keep: z.number().int().min(1).max(60),
    timezone: z
      .string()
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
  })
  .strict()
  .refine((value) => value.mode !== "twice" || value.times.length === 2, {
    message: "Two times are needed for two backups a day.",
  });
export type BackupSchedule = z.infer<typeof scheduleSchema>;
export const DEFAULT_SCHEDULE: BackupSchedule = {
  mode: "daily",
  times: ["02:00", "14:00"],
  keep: 14,
  timezone: "Europe/Zurich",
};

type Kind = "scheduled" | "manual" | "safety";
interface BackupRow {
  id: string;
  created_at: string;
  kind: Kind;
  label: string;
  size_bytes: number | string;
  sessions: number | string;
  accounts: number | string;
  app_version: string;
  created_by: string | null;
}

/** Milliseconds between the wall clock of `timeZone` and UTC at `at`. */
function zoneOffset(at: number, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return (
    Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    ) -
    Math.floor(at / 1000) * 1000
  );
}
function zonedTime(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(first, timeZone);
}
/** The most recent scheduled time at or before `now`, if any. */
export function latestSlot(schedule: BackupSchedule, now: number) {
  if (schedule.mode === "off") return null;
  const times =
    schedule.mode === "daily" ? [schedule.times[0]] : schedule.times;
  let latest: number | null = null;
  for (const daysAgo of [0, 1, 2]) {
    const date = localDate(
      new Date(now - daysAgo * 86_400_000),
      schedule.timezone,
    );
    for (const time of times) {
      const at = zonedTime(date, time, schedule.timezone);
      if (at <= now && (latest === null || at > latest)) latest = at;
    }
  }
  return latest;
}
export function nextSlot(schedule: BackupSchedule, now: number) {
  if (schedule.mode === "off") return null;
  const times =
    schedule.mode === "daily" ? [schedule.times[0]] : schedule.times;
  let next: number | null = null;
  for (const daysAhead of [0, 1, 2]) {
    const date = localDate(
      new Date(now + daysAhead * 86_400_000),
      schedule.timezone,
    );
    for (const time of times) {
      const at = zonedTime(date, time, schedule.timezone);
      if (at > now && (next === null || at < next)) next = at;
    }
  }
  return next;
}

export async function registerBackups(
  app: Express,
  {
    db,
    admin,
    version,
    config = {},
    now = Date.now,
  }: {
    db: Database;
    admin: RequestHandler;
    version: AppVersion;
    config?: BackupConfig;
    now?: () => number;
  },
) {
  await db.transaction(async (sql) => {
    await sql.run(
      "CREATE TABLE IF NOT EXISTS app_backups(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL,size_bytes BIGINT NOT NULL,sessions INTEGER NOT NULL,accounts INTEGER NOT NULL,app_version TEXT NOT NULL,created_by TEXT,data TEXT NOT NULL)",
    );
    await sql.run(
      "CREATE INDEX IF NOT EXISTS app_backups_created_idx ON app_backups(created_at)",
    );
    await sql.run(
      "CREATE TABLE IF NOT EXISTS backup_schedule(id TEXT PRIMARY KEY,last_slot BIGINT NOT NULL)",
    );
    await sql.run(
      "INSERT INTO backup_schedule(id,last_slot) VALUES('scheduled',0) ON CONFLICT(id) DO NOTHING",
    );
  });
  const maxBytes = config.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  const dialect = await dialectOf(db);
  // Sensitive, rare operations: a small budget per account.
  const sensitive = rateLimit(
    30,
    15 * 60_000,
    (_request, response) => `data-admin:${(response.locals.user as User).id}`,
  );

  const schedule = async (sql: Sql = db): Promise<BackupSchedule> => {
    const [row] = await sql.all<{ payload: string }>(
      "SELECT payload FROM app_settings WHERE id='backups'",
    );
    if (!row) return DEFAULT_SCHEDULE;
    const parsed = scheduleSchema.safeParse(JSON.parse(row.payload));
    return parsed.success ? parsed.data : DEFAULT_SCHEDULE;
  };

  /** Stores a snapshot of the current data. */
  const createBackup = async (
    kind: Kind,
    label: string,
    createdBy: string | null,
  ) => {
    const snapshot = await takeSnapshot(db, version);
    const data = compress(snapshot);
    const { sessions, accounts } = snapshotSummary(snapshot);
    const id = randomUUID();
    await db.transaction(async (sql) => {
      await sql.run(
        "INSERT INTO app_backups(id,created_at,kind,label,size_bytes,sessions,accounts,app_version,created_by,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [
          id,
          new Date(now()).toISOString(),
          kind,
          label,
          data.length,
          sessions,
          accounts,
          version.version,
          createdBy,
          data.toString("base64"),
        ],
      );
      // Retention: scheduled backups by the configured count, safety points
      // (taken before a restore or an import) by the last few. Manual
      // checkpoints stay until an administrator deletes them.
      const keep =
        kind === "scheduled"
          ? (await schedule(sql)).keep
          : kind === "safety"
            ? SAFETY_KEPT
            : null;
      if (keep !== null) {
        const old = await sql.all<{ id: string }>(
          "SELECT id FROM app_backups WHERE kind=$1 ORDER BY created_at DESC, id DESC",
          [kind],
        );
        for (const row of old.slice(keep))
          await sql.run("DELETE FROM app_backups WHERE id=$1", [row.id]);
      }
    });
    return id;
  };

  const loadBackup = async (id: string): Promise<Snapshot> => {
    const [row] = await db.all<{ data: string }>(
      "SELECT data FROM app_backups WHERE id=$1",
      [id],
    );
    if (!row) fail(404, "NOT_FOUND", "This backup does not exist.");
    return decompress(Buffer.from(row!.data, "base64"), maxBytes);
  };

  // ── Scheduler: every pod checks each minute; the first to claim a slot in
  // `backup_schedule` takes the backup, so two pods never both do.
  let running = false;
  const runScheduled = async (at = now()) => {
    if (running) return false;
    running = true;
    try {
      const slot = latestSlot(await schedule(), at);
      if (slot === null) return false;
      const [state] = await db.all<{ last_slot: number | string }>(
        "SELECT last_slot FROM backup_schedule WHERE id='scheduled'",
      );
      const previous = Number(state?.last_slot ?? 0);
      if (previous >= slot) return false;
      const claimed = await db.run(
        "UPDATE backup_schedule SET last_slot=$1 WHERE id='scheduled' AND last_slot=$2",
        [slot, state?.last_slot ?? 0],
      );
      if (claimed !== 1) return false;
      try {
        await createBackup("scheduled", "", null);
      } catch (error) {
        // Released so the next check retries; the message names no data.
        await db.run(
          "UPDATE backup_schedule SET last_slot=$1 WHERE id='scheduled' AND last_slot=$2",
          [previous, slot],
        );
        log.error("Scheduled backup failed", {
          reason: (error as Error).message.slice(0, 200),
        });
        return false;
      }
      return true;
    } finally {
      running = false;
    }
  };
  const timers: NodeJS.Timeout[] = [];
  if (config.scheduler) {
    const check = () => void runScheduled().catch(() => undefined);
    timers.push(setTimeout(check, 15_000), setInterval(check, 60_000));
    for (const timer of timers) timer.unref();
  }

  // ── Shared checks for operations that read out or replace all data.
  const confirmSchema = z.enum(["REMPLACER", "REPLACE"]);
  const reauthenticate = async (response: Response, password?: string) => {
    const current = response.locals.user as User;
    const [row] = await db.all<{ password: string; oidc: number | string }>(
      "SELECT u.password,(SELECT COUNT(*) FROM oidc_identities o WHERE o.user_id=u.id) AS oidc FROM users u WHERE u.id=$1",
      [current.id],
    );
    // Accounts signed in through the organization (OIDC) have no password
    // they know: their sign-in already went through the identity provider.
    if (Number(row?.oidc ?? 0) > 0 && !password) return;
    if (!row || !password || !(await verifyPassword(password, row.password)))
      fail(403, "REAUTH_FAILED", "Your password is needed to confirm.");
  };
  const snapshotFailure = (error: unknown) => {
    if (error instanceof SnapshotError)
      fail(
        error.code === "ARCHIVE_TOO_LARGE" ? 413 : 400,
        error.code,
        error.message,
      );
    throw error;
  };
  /** Replaces all data after keeping a safety point. Everyone is signed out,
   * the administrator included: accounts may differ after the change. */
  const replaceAll = async (
    request: Request,
    response: Response,
    snapshot: Snapshot,
    action: "data.import" | "backup.restore",
    detail: Record<string, string | number>,
  ) => {
    const actor = (response.locals.user as User).id;
    const safety = await createBackup(
      "safety",
      action === "data.import" ? "Avant import" : "Avant restauration",
      actor,
    );
    await db.transaction(async (sql) => {
      await replaceWithSnapshot(sql, dialect, snapshot).catch(snapshotFailure);
      await audit(sql, request, response, action, {
        actorId: actor,
        detail: { ...detail, safetyBackup: safety },
      });
    });
    response.json({ signedOut: true, safetyBackup: safety });
  };

  const publicBackup = (row: BackupRow) => ({
    id: row.id,
    createdAt: row.created_at,
    kind: row.kind,
    label: row.label,
    sizeBytes: Number(row.size_bytes),
    sessions: Number(row.sessions),
    accounts: Number(row.accounts),
    appVersion: row.app_version,
  });
  const idParam = z.uuid();

  app.get("/api/admin/backups", admin, async (_request, response) => {
    const settings = await schedule();
    const rows = await db.all<BackupRow>(
      "SELECT id,created_at,kind,label,size_bytes,sessions,accounts,app_version,created_by FROM app_backups ORDER BY created_at DESC, id DESC",
    );
    response.json({
      settings,
      nextRun: nextSlot(settings, now()),
      scheduler: !!config.scheduler,
      backups: rows.map(publicBackup),
    });
  });
  app.put("/api/admin/backups/settings", admin, async (request, response) => {
    const settings = scheduleSchema.parse(request.body);
    await db.transaction(async (sql) => {
      await sql.run(
        "INSERT INTO app_settings(id,payload) VALUES('backups',$1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
        [JSON.stringify(settings)],
      );
      // A new schedule starts from now: no immediate catch-up backup.
      const slot = latestSlot(settings, now());
      if (slot !== null)
        await sql.run(
          "UPDATE backup_schedule SET last_slot=$1 WHERE id='scheduled' AND last_slot<$1",
          [slot],
        );
      await audit(sql, request, response, "settings.backups", {
        detail: {
          mode: settings.mode,
          times: settings.times.join(","),
          keep: settings.keep,
        },
      });
    });
    response.json({ settings, nextRun: nextSlot(settings, now()) });
  });
  app.post(
    "/api/admin/backups",
    admin,
    sensitive,
    async (request, response) => {
      const { label } = z
        .object({ label: z.string().trim().max(120).default("") })
        .strict()
        .parse(request.body);
      const [count] = await db.all<{ count: number | string }>(
        "SELECT COUNT(*) AS count FROM app_backups WHERE kind='manual'",
      );
      if (Number(count?.count ?? 0) >= MANUAL_LIMIT)
        fail(
          409,
          "BACKUP_LIMIT",
          `Delete an older checkpoint first (${MANUAL_LIMIT} at most).`,
        );
      const id = await createBackup(
        "manual",
        label,
        (response.locals.user as User).id,
      );
      await db.transaction((sql) =>
        audit(sql, request, response, "backup.create", { target: id }),
      );
      const [row] = await db.all<BackupRow>(
        "SELECT id,created_at,kind,label,size_bytes,sessions,accounts,app_version,created_by FROM app_backups WHERE id=$1",
        [id],
      );
      response.status(201).json({ backup: publicBackup(row) });
    },
  );
  app.delete("/api/admin/backups/:id", admin, async (request, response) => {
    const id = idParam.parse(request.params.id);
    await db.transaction(async (sql) => {
      if (!(await sql.run("DELETE FROM app_backups WHERE id=$1", [id])))
        fail(404, "NOT_FOUND", "This backup does not exist.");
      await audit(sql, request, response, "backup.delete", { target: id });
    });
    response.json({ deleted: true });
  });
  app.get(
    "/api/admin/backups/:id/sessions",
    admin,
    async (request, response) => {
      const snapshot = await loadBackup(idParam.parse(request.params.id));
      const users = new Map(
        (snapshot.tables.users?.rows ?? []).map((row) => {
          const columns = snapshot.tables.users.columns;
          return [
            row[columns.indexOf("id")],
            row[columns.indexOf("name")],
          ] as const;
        }),
      );
      const table = snapshot.tables.sessions ?? { columns: [], rows: [] };
      const column = (name: string) => table.columns.indexOf(name);
      const existing = new Set(
        (await db.all<{ id: string }>("SELECT id FROM sessions")).map(
          (row) => row.id,
        ),
      );
      response.json({
        sessions: table.rows
          .map((row) => {
            const payload = JSON.parse(String(row[column("payload")])) as {
              title?: string;
            };
            const id = String(row[column("id")]);
            return {
              id,
              title: String(payload.title ?? ""),
              owner: String(users.get(row[column("owner_id")]) ?? ""),
              updatedAt: String(row[column("updated_at")] ?? ""),
              exists: existing.has(id),
            };
          })
          .sort((a, b) => a.title.localeCompare(b.title)),
      });
    },
  );
  // Brings one session back as a new copy, leaving everything else as is:
  // the common case of someone losing or breaking one agenda.
  app.post(
    "/api/admin/backups/:id/sessions/:sessionId/restore",
    admin,
    sensitive,
    async (request, response) => {
      const backupId = idParam.parse(request.params.id);
      const sessionId = z
        .string()
        .min(1)
        .max(120)
        .parse(request.params.sessionId);
      const snapshot = await loadBackup(backupId);
      const table = snapshot.tables.sessions;
      const row = table?.rows.find(
        (value) => value[table.columns.indexOf("id")] === sessionId,
      );
      if (!row) fail(404, "NOT_FOUND", "This session is not in the backup.");
      const original = JSON.parse(
        String(row![table.columns.indexOf("payload")]),
      ) as Session;
      const originalOwner = String(row![table.columns.indexOf("owner_id")]);
      const current = response.locals.user as User;
      const [owner] = await db.all<{ id: string }>(
        "SELECT id FROM users WHERE id=$1",
        [originalOwner],
      );
      const stamp = new Date(now()).toISOString();
      const copy: Session = {
        ...original,
        id: randomUUID(),
        title:
          `${original.title} (${localDate(new Date(now()), "Europe/Zurich")})`.slice(
            0,
            200,
          ),
        ownerId: owner?.id ?? current.id,
        run: { ...INITIAL_RUN, dayId: original.days[0]?.id ?? "" },
        version: 1,
        updatedAt: stamp,
      };
      delete copy.lifecycle;
      delete copy.workspaceId;
      await db.transaction(async (sql) => {
        await sql.run(
          "INSERT INTO sessions(id,owner_id,payload,version,updated_at) VALUES($1,$2,$3,$4,$5)",
          [copy.id, copy.ownerId, storedSession(copy), copy.version, stamp],
        );
        await audit(sql, request, response, "backup.restore-session", {
          target: copy.id,
          detail: { backup: backupId, from: sessionId },
        });
      });
      response.status(201).json({
        session: { id: copy.id, title: copy.title, ownerId: copy.ownerId },
      });
    },
  );
  app.post(
    "/api/admin/backups/:id/restore",
    admin,
    sensitive,
    async (request, response) => {
      const id = idParam.parse(request.params.id);
      const input = z
        .object({
          password: z.string().max(256).optional(),
          confirm: confirmSchema,
        })
        .strict()
        .parse(request.body);
      await reauthenticate(response, input.password);
      const snapshot = await loadBackup(id);
      await replaceAll(request, response, snapshot, "backup.restore", {
        backup: id,
        ...snapshotSummary(snapshot),
      });
    },
  );
  const archiveName = (at: number) =>
    `meetloom-${new Date(at).toISOString().slice(0, 16).replace(/[:T]/g, "-")}.mldx`;
  const sendArchive = async (
    response: Response,
    snapshot: Snapshot,
    passphrase: string,
  ) => {
    const archive = await encrypt(compress(snapshot), passphrase);
    response
      .status(200)
      .type("application/octet-stream")
      .attachment(archiveName(Date.parse(snapshot.createdAt) || now()))
      .send(archive);
  };
  const passphrase = z.string().min(PASSPHRASE_MIN).max(1024);
  app.post(
    "/api/admin/backups/:id/download",
    admin,
    sensitive,
    async (request, response) => {
      const id = idParam.parse(request.params.id);
      const input = z
        .object({ password: z.string().max(256).optional(), passphrase })
        .strict()
        .parse(request.body);
      await reauthenticate(response, input.password);
      const snapshot = await loadBackup(id);
      await db.transaction((sql) =>
        audit(sql, request, response, "backup.download", { target: id }),
      );
      await sendArchive(response, snapshot, input.passphrase);
    },
  );
  app.post(
    "/api/admin/data/export",
    admin,
    sensitive,
    async (request, response) => {
      const input = z
        .object({ password: z.string().max(256).optional(), passphrase })
        .strict()
        .parse(request.body);
      await reauthenticate(response, input.password);
      const snapshot = await takeSnapshot(db, version);
      await db.transaction((sql) =>
        audit(sql, request, response, "data.export", {
          detail: snapshotSummary(snapshot),
        }),
      );
      await sendArchive(response, snapshot, input.passphrase);
    },
  );
  app.post(
    "/api/admin/data/import",
    admin,
    sensitive,
    async (request, response) => {
      const input = z
        .object({
          archive: z.base64().max(Math.ceil((maxBytes * 4) / 3) + 4),
          passphrase,
          password: z.string().max(256).optional(),
          confirm: confirmSchema,
        })
        .strict()
        .parse(request.body);
      await reauthenticate(response, input.password);
      let snapshot: Snapshot;
      try {
        snapshot = decompress(
          await decrypt(Buffer.from(input.archive, "base64"), input.passphrase),
          maxBytes,
        );
      } catch (error) {
        return snapshotFailure(error);
      }
      await replaceAll(request, response, snapshot, "data.import", {
        from: snapshot.app?.version ?? "unknown",
        createdAt: snapshot.createdAt,
        ...snapshotSummary(snapshot),
      });
    },
  );

  return {
    runScheduled,
    createBackup,
    close() {
      for (const timer of timers) clearTimeout(timer);
    },
  };
}

/** The import body is large: parsed only for signed-in administrators,
 * before the application's 1 MB JSON parser. */
export function importBodyParser(maxArchiveBytes: number): RequestHandler[] {
  return [
    (_request, response, next) =>
      (response.locals.user as User | undefined)?.isAdmin
        ? next()
        : fail(403, "FORBIDDEN", "Administrator access is required."),
    express.json({
      limit: Math.ceil((maxArchiveBytes * 4) / 3) + 64 * 1024,
      strict: true,
    }),
  ];
}
