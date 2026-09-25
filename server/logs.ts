import type { Express, RequestHandler } from "express";
import { randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { z } from "zod";
import type { Database } from "./db.js";
import { addLogSink, type LogEntry } from "./log.js";

export interface LogConfig {
  /** Lines older than this are deleted. */
  retentionDays?: number;
  /** At most this many lines are kept across all pods. */
  maxRows?: number;
}

const FLUSH_EVERY_MS = 2_000;
const PRUNE_EVERY_MS = 10 * 60_000;
/** Lines waiting for the database; beyond, new ones are counted and dropped. */
const BUFFER_LIMIT = 1_000;

/**
 * Keeps the server log lines of every pod in `server_logs`, so that
 * administrators read them in the application (Mon compte → Journaux)
 * without access to OpenShift. Lines are buffered and written every few
 * seconds; a database failure never blocks or loops the logging itself.
 */
export async function registerLogs(
  app: Express,
  {
    db,
    admin,
    config = {},
  }: { db: Database; admin: RequestHandler; config?: LogConfig },
) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS server_logs (id TEXT PRIMARY KEY, at TEXT NOT NULL, level TEXT NOT NULL, pod TEXT NOT NULL, message TEXT NOT NULL, details TEXT)",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS server_logs_at_idx ON server_logs(at)",
  );
  const retentionDays = config.retentionDays ?? 14;
  const maxRows = config.maxRows ?? 20_000;
  // OpenShift names the pod after its hostname.
  const pod = hostname().slice(0, 120);
  // Lines of one pod sort in the order they were written, even within a
  // millisecond; the prefix keeps ids unique across pods.
  const prefix = randomBytes(6).toString("hex");
  let sequence = 0;
  let buffer: (LogEntry & { id: string })[] = [];
  let dropped = 0;
  const remove = addLogSink((entry) => {
    if (buffer.length >= BUFFER_LIMIT) {
      dropped++;
      return;
    }
    buffer.push({
      ...entry,
      id: `${prefix}-${String(++sequence).padStart(12, "0")}`,
    });
  });
  let flushing: Promise<void> | undefined;
  const flush = async () => {
    await flushing;
    if (!buffer.length && !dropped) return;
    const batch = buffer;
    buffer = [];
    if (dropped) {
      batch.push({
        id: `${prefix}-${String(++sequence).padStart(12, "0")}`,
        at: new Date().toISOString(),
        level: "warn",
        message: `${dropped} log lines were dropped: too many at once.`,
      });
      dropped = 0;
    }
    flushing = db
      .transaction(async (sql) => {
        for (const entry of batch)
          await sql.run(
            "INSERT INTO server_logs(id,at,level,pod,message,details) VALUES($1,$2,$3,$4,$5,$6)",
            [
              entry.id,
              entry.at,
              entry.level,
              pod,
              entry.message,
              entry.details ? JSON.stringify(entry.details) : null,
            ],
          );
      })
      .catch((error: unknown) => {
        // Straight to the output: logging it through log.* would loop.
        console.error(
          "Could not store log lines:",
          error instanceof Error ? error.message.slice(0, 200) : "unknown",
        );
      });
    await flushing;
    flushing = undefined;
  };
  const prune = async () => {
    await db.run("DELETE FROM server_logs WHERE at < $1", [
      new Date(Date.now() - retentionDays * 86_400_000).toISOString(),
    ]);
    await db.run(
      "DELETE FROM server_logs WHERE id IN (SELECT id FROM server_logs ORDER BY at DESC, id DESC LIMIT 1000000000 OFFSET $1)",
      [maxRows],
    );
  };
  const flushTimer = setInterval(() => void flush(), FLUSH_EVERY_MS);
  flushTimer.unref();
  const pruneTimer = setInterval(
    () =>
      void prune().catch(() => console.error("Could not prune old log lines.")),
    PRUNE_EVERY_MS,
  );
  pruneTimer.unref();

  app.get("/api/admin/logs", admin, async (request, response) => {
    const query = z
      .object({
        level: z.enum(["info", "warn", "error"]).default("info"),
        q: z.string().trim().max(200).default(""),
        before: z.iso.datetime().optional(),
      })
      .parse(request.query);
    await flush();
    const levels =
      query.level === "error"
        ? ["error"]
        : query.level === "warn"
          ? ["warn", "error"]
          : ["info", "warn", "error"];
    const where = [
      `level IN (${levels.map((_, index) => `$${index + 1}`).join(",")})`,
    ];
    const values: string[] = [...levels];
    if (query.q) {
      values.push(`%${query.q.toLowerCase()}%`);
      where.push(
        `(LOWER(message) LIKE $${values.length} OR LOWER(COALESCE(details,'')) LIKE $${values.length})`,
      );
    }
    if (query.before) {
      values.push(new Date(query.before).toISOString());
      where.push(`at < $${values.length}`);
    }
    const rows = await db.all<{
      id: string;
      at: string;
      level: string;
      pod: string;
      message: string;
      details: string | null;
    }>(
      `SELECT id,at,level,pod,message,details FROM server_logs WHERE ${where.join(" AND ")} ORDER BY at DESC, id DESC LIMIT 300`,
      values,
    );
    response.json({
      retentionDays,
      logs: rows.map((row) => ({
        ...row,
        details: row.details ? JSON.parse(row.details) : null,
      })),
    });
  });
  return {
    flush,
    prune,
    close: async () => {
      clearInterval(flushTimer);
      clearInterval(pruneTimer);
      remove();
      await flush();
    },
  };
}
