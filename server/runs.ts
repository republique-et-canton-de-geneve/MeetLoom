import type { Express, RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Role, Session } from "../shared/model.js";
import type { RunRecord } from "../shared/history.js";
import { runnableBlocks } from "../shared/domain.js";
import type { Database, Sql } from "./db.js";

/**
 * Each finished run of a day, kept with the plan it started from and the time
 * actually spent. "Use actual durations" changes the agenda, never these
 * records: the first run of a day always holds its initial plan.
 */
export async function createRunTables(db: Database) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS session_runs (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, day_id TEXT NOT NULL, payload TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL)",
  );
  await db.run(
    "CREATE INDEX IF NOT EXISTS session_runs_session_idx ON session_runs(session_id,finished_at)",
  );
}

/** Inside the save that finishes a run, so both commit together. */
export async function recordFinishedRun(
  sql: Sql,
  previous: Session,
  next: Session,
) {
  const run = next.run;
  if (previous.run.status === "finished" || run.status !== "finished") return;
  const day = next.days.find((value) => value.id === run.dayId);
  if (!day || run.runStartedAt === null) return;
  const record: RunRecord = {
    id: randomUUID(),
    dayId: day.id,
    dayTitle: day.title,
    startedAt: new Date(run.runStartedAt).toISOString(),
    finishedAt: new Date().toISOString(),
    blocks: runnableBlocks(day.blocks).map((block) => ({
      id: block.id,
      title: block.title,
      planned: run.plannedDurations?.[block.id] ?? block.duration * 60,
      actual: Math.round(run.actualDurations?.[block.id] ?? 0),
    })),
    plan: run.plannedDurations ?? {},
  };
  await sql.run(
    "INSERT INTO session_runs(id,session_id,day_id,payload,started_at,finished_at) VALUES($1,$2,$3,$4,$5,$6)",
    [
      record.id,
      next.id,
      record.dayId,
      JSON.stringify({
        dayTitle: record.dayTitle,
        blocks: record.blocks,
        plan: record.plan,
      }),
      record.startedAt,
      record.finishedAt,
    ],
  );
}

export function installRunsApi(
  app: Express,
  {
    db,
    authenticated,
    accessible,
  }: {
    db: Database;
    authenticated: RequestHandler;
    accessible: (
      id: string,
      userId: string,
      roles?: Role[],
    ) => Promise<{ session: Session; role: Role }>;
  },
) {
  app.get(
    "/api/sessions/:id/runs",
    authenticated,
    async (request, response) => {
      const { session } = await accessible(
        z.string().min(1).max(120).parse(request.params.id),
        (response.locals.user as { id: string }).id,
      );
      const rows = await db.all<{
        id: string;
        day_id: string;
        payload: string;
        started_at: string;
        finished_at: string;
      }>(
        "SELECT id,day_id,payload,started_at,finished_at FROM session_runs WHERE session_id=$1 ORDER BY finished_at,id LIMIT 200",
        [session.id],
      );
      response.json({
        runs: rows.map((row): RunRecord => {
          const payload = JSON.parse(row.payload) as Pick<
            RunRecord,
            "dayTitle" | "blocks" | "plan"
          >;
          return {
            id: row.id,
            dayId: row.day_id,
            dayTitle: payload.dayTitle,
            startedAt: row.started_at,
            finishedAt: row.finished_at,
            blocks: payload.blocks,
            plan: payload.plan ?? {},
          };
        }),
      });
    },
  );
}
