import type { Session } from "../shared/model.js";
import { runnableBlocks, timerView, transitionRun } from "../shared/domain.js";
import type { Database, Sql } from "./db.js";

const HOUR = 60 * 60 * 1000;
/** A running timer whose step is a day past its time, with nothing
 * happening on the session for as long, was forgotten. */
const RUNNING_QUIET = 24 * HOUR;
/** A paused timer no longer counts: it waits a week without any change,
 * so a session paused overnight or over a weekend resumes where it was. */
const PAUSED_QUIET = 7 * 24 * HOUR;

/**
 * A timer nobody will stop: the last step never marked as done keeps
 * counting, or a test is left running. It is stopped only when both the
 * timer and the session have been left alone for hours, never on the clock
 * or the time of day, so a real session (several days included, each day
 * being its own run) is not interrupted:
 * - running: its current step overran by 24 hours and nothing changed on
 *   the session (edits, next, extensions, pauses) for 24 hours;
 * - paused: nothing changed on the session for 7 days.
 */
export function forgottenRun(session: Session, now: number): boolean {
  const run = session.run;
  if (run.status !== "running" && run.status !== "paused") return false;
  const quiet = now - Date.parse(session.updatedAt);
  if (!Number.isFinite(quiet)) return false;
  if (run.status === "paused") return quiet >= PAUSED_QUIET;
  const view = timerView(session, now);
  // A scheduled start still ahead is waiting, not forgotten.
  if (!view.block || view.startsInSeconds > 0) return false;
  return (
    -view.remainingSeconds * 1000 >= RUNNING_QUIET && quiet >= RUNNING_QUIET
  );
}

/** Stops a forgotten timer. When the current step really ended is unknown,
 * so it counts for its planned time, running or paused, rather than the
 * whole night or wherever a pause left it. */
export function stopForgotten(session: Session, now: number): Session {
  const synced = transitionRun(session, "sync", {}, now);
  const run = synced.run;
  if (run.status !== "running" && run.status !== "paused") return synced;
  const block = runnableBlocks(
    synced.days.find((day) => day.id === run.dayId)?.blocks ?? [],
  ).find((value) => value.id === run.blockId);
  return transitionRun(
    {
      ...synced,
      run: {
        ...run,
        status: "paused",
        startedAt: null,
        elapsedBeforePause: (block?.duration ?? 0) * 60,
      },
    },
    "stop",
    {},
    now,
  );
}

/** `active_runs` lists the sessions whose timer runs, so the sweep reads
 * those instead of every agenda. */
export async function createForgottenRunTables(db: Database) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS active_runs (session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, since TEXT NOT NULL)",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS sessions_updated_idx ON sessions(updated_at)",
  );
  // Timers started before this table existed: one scan at startup, then
  // every save keeps the list current.
  await rebuildActiveRuns(db);
}

/** Lists again every running or paused timer, of every session or only of
 * those saved since `since` (an ISO time). Pods may do it at the same time. */
export const rebuildActiveRuns = (sql: Sql, since?: string) =>
  sql.run(
    `INSERT INTO active_runs(session_id,since) SELECT id,$1 FROM sessions WHERE ${since ? "updated_at>=$2 AND " : ""}(payload LIKE '%"status":"running"%' OR payload LIKE '%"status":"paused"%') AND id NOT IN (SELECT session_id FROM active_runs) ON CONFLICT(session_id) DO NOTHING`,
    since ? [new Date().toISOString(), since] : [new Date().toISOString()],
  );

/** Inside every session save: lists or unlists the session's timer. */
export async function trackActiveRun(sql: Sql, next: Session) {
  if (next.run.status === "running" || next.run.status === "paused")
    await sql.run(
      "INSERT INTO active_runs(session_id,since) VALUES($1,$2) ON CONFLICT(session_id) DO NOTHING",
      [next.id, new Date().toISOString()],
    );
  else await sql.run("DELETE FROM active_runs WHERE session_id=$1", [next.id]);
}
