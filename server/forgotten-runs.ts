import type { Session } from "../shared/model.js";
import {
  elapsedSeconds,
  runnableBlocks,
  transitionRun,
} from "../shared/domain.js";
import type { Database, Sql } from "./db.js";

const HOUR = 60 * 60 * 1000;

/** The hour of the day where the session takes place (0 to 23). */
function localHour(timezone: string, now: number) {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "numeric",
        hourCycle: "h23",
      }).format(now),
    );
  } catch {
    return new Date(now).getUTCHours();
  }
}

/**
 * A timer nobody stopped: still running or paused an hour past the end of
 * its plan. During the day its organizers are reminded once; from 23:00 to
 * 05:00 in the session's time zone it is stopped. A session still within
 * its plan is never interrupted, whatever the hour.
 */
export function forgottenRun(
  session: Session,
  now: number,
): "remind" | "stop" | null {
  const run = session.run;
  if (
    (run.status !== "running" && run.status !== "paused") ||
    run.runStartedAt === null
  )
    return null;
  const day = session.days.find((value) => value.id === run.dayId);
  const planned =
    run.plannedTotal ??
    runnableBlocks(day?.blocks ?? []).reduce(
      (sum, block) => sum + block.duration * 60,
      0,
    );
  if (now - (run.runStartedAt + planned * 1000) < HOUR) return null;
  const hour = localHour(session.timezone, now);
  return hour >= 23 || hour < 5 ? "stop" : "remind";
}

/** Stops a forgotten timer. When the current block really ended is unknown,
 * so it is credited with its planned time, not with the whole night. */
export function stopForgotten(session: Session, now: number): Session {
  const synced = transitionRun(session, "sync", {}, now);
  const run = synced.run;
  if (run.status !== "running" && run.status !== "paused") return synced;
  const block = runnableBlocks(
    synced.days.find((day) => day.id === run.dayId)?.blocks ?? [],
  ).find((value) => value.id === run.blockId);
  const planned = (block?.duration ?? 0) * 60,
    elapsed = elapsedSeconds(run, now);
  const at =
    run.status === "running" && run.startedAt !== null && elapsed > planned
      ? Math.max(run.startedAt, now - (elapsed - planned) * 1000)
      : now;
  return transitionRun(synced, "stop", {}, at);
}

/** One reminder and one stop per run, whichever pod gets there first. */
export async function createForgottenRunTables(db: Database) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS run_reminders (session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, run_started_at BIGINT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(session_id,run_started_at,kind))",
  );
}

export const claimForgottenRun = (
  sql: Sql,
  session: Session,
  kind: "remind" | "stop",
) =>
  sql.run(
    "INSERT INTO run_reminders(session_id,run_started_at,kind,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,run_started_at,kind) DO NOTHING",
    [session.id, session.run.runStartedAt, kind, new Date().toISOString()],
  );
