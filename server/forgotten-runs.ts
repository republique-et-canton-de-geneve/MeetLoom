import type { Session } from "../shared/model.js";
import { runnableBlocks, transitionRun } from "../shared/domain.js";
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
 * its plan, extensions included. During the day its organizers are reminded once; from 23:00 to
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
  const blocks = runnableBlocks(day?.blocks ?? []);
  // The plan from the starting step, plus the time added since (extensions,
  // longer or new steps); steps skipped before the start do not count. It
  // never ends earlier than the plan at the start.
  const planned =
    run.plannedTotal === undefined
      ? blocks.reduce((sum, block) => sum + block.duration * 60, 0)
      : run.plannedTotal +
        Math.max(
          0,
          blocks.reduce(
            (sum, block) =>
              sum +
              Math.max(
                0,
                block.duration * 60 - (run.plannedDurations?.[block.id] ?? 0),
              ),
            0,
          ),
        );
  if (now - (run.runStartedAt + planned * 1000) < HOUR) return null;
  const hour = localHour(session.timezone, now);
  return hour >= 23 || hour < 5 ? "stop" : "remind";
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

/** One reminder and one stop per run, whichever pod gets there first;
 * `active_runs` lists the sessions whose timer runs, so the sweep reads
 * those instead of every agenda. */
export async function createForgottenRunTables(db: Database) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS run_reminders (session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, run_started_at BIGINT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(session_id,run_started_at,kind))",
  );
  await db.run(
    "CREATE TABLE IF NOT EXISTS active_runs (session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE, since TEXT NOT NULL)",
  );
  // Timers started before this table existed: one scan at startup, then
  // every save keeps the list current.
  await rebuildActiveRuns(db);
}

/** Lists every running or paused timer again (startup, restore, import). */
export const rebuildActiveRuns = (sql: Sql) =>
  sql.run(
    `INSERT INTO active_runs(session_id,since) SELECT id,$1 FROM sessions WHERE (payload LIKE '%"status":"running"%' OR payload LIKE '%"status":"paused"%') AND id NOT IN (SELECT session_id FROM active_runs)`,
    [new Date().toISOString()],
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

export const claimForgottenRun = (
  sql: Sql,
  session: Session,
  kind: "remind" | "stop",
) =>
  sql.run(
    "INSERT INTO run_reminders(session_id,run_started_at,kind,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(session_id,run_started_at,kind) DO NOTHING",
    [session.id, session.run.runStartedAt, kind, new Date().toISOString()],
  );
