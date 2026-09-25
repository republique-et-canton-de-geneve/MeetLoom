import type { Express, RequestHandler } from "express";
import type { Database } from "./db.js";
import type { Session } from "../shared/model.js";
import { runnableBlocks } from "../shared/domain.js";
import type { AppVersion } from "./version.js";

/** Visitor links polled within this window count as followed right now. */
const LINK_ACTIVE_MS = 3 * 60_000;
/** Each pod records a link's activity at most this often: visitors poll
 * every three seconds, and one write a minute is enough to see them. */
const LINK_WRITE_EVERY_MS = 60_000;
/** Same window as the presence heartbeats (server/presence.ts). */
const EDITOR_ACTIVE_MS = 30_000;

export interface ActiveSession {
  id: string;
  title: string;
  owner: string;
  timer: {
    status: "running" | "paused" | "scheduled";
    day: string | null;
    block: string | null;
    /** When the run started (or will start, when scheduled). */
    since: number | null;
  } | null;
  /** Accounts with the editor open. */
  editors: number;
  /** Visitor links polled in the last few minutes. */
  visitorLinks: number;
}

/**
 * What an administrator checks before updating the application: the
 * version running, and the sessions someone would notice being interrupted.
 * An update replaces pods one at a time, so nobody should lose work, but a
 * live timer or a room following a link is better left alone.
 */
export async function registerOperations(
  app: Express,
  {
    db,
    authenticated,
    admin,
    version,
    now = Date.now,
  }: {
    db: Database;
    authenticated: RequestHandler;
    admin: RequestHandler;
    version: AppVersion;
    now?: () => number;
  },
) {
  await db.run(
    "CREATE TABLE IF NOT EXISTS share_activity(share_id TEXT PRIMARY KEY REFERENCES shares(id) ON DELETE CASCADE,last_seen BIGINT NOT NULL)",
  );
  const written = new Map<string, number>();
  /** Called on every visitor poll; never fails the poll. */
  const linkVisited = async (shareId: string) => {
    const at = now();
    if (at - (written.get(shareId) ?? 0) < LINK_WRITE_EVERY_MS) return;
    if (written.size > 10_000) written.clear();
    written.set(shareId, at);
    try {
      await db.run(
        "INSERT INTO share_activity(share_id,last_seen) VALUES($1,$2) ON CONFLICT(share_id) DO UPDATE SET last_seen=excluded.last_seen",
        [shareId, at],
      );
    } catch {
      written.delete(shareId);
    }
  };

  app.get("/api/about", authenticated, (_request, response) => {
    response.json(version);
  });

  app.get("/api/admin/activity", admin, async (_request, response) => {
    const checkedAt = now();
    const editors = new Map(
      (
        await db.all<{ session_id: string; editors: number | string }>(
          "SELECT session_id,COUNT(DISTINCT user_id) AS editors FROM presence_heartbeats WHERE last_seen>$1 GROUP BY session_id",
          [checkedAt - EDITOR_ACTIVE_MS],
        )
      ).map((row) => [row.session_id, Number(row.editors)]),
    );
    const links = new Map(
      (
        await db.all<{ session_id: string; links: number | string }>(
          "SELECT l.session_id,COUNT(*) AS links FROM share_activity a JOIN shares l ON l.id=a.share_id WHERE a.last_seen>$1 GROUP BY l.session_id",
          [checkedAt - LINK_ACTIVE_MS],
        )
      ).map((row) => [row.session_id, Number(row.links)]),
    );
    // Timers live in the session payload: the text filter only narrows the
    // scan, the parsed run state decides.
    const ids = [...new Set([...editors.keys(), ...links.keys()])];
    const rows = await db.all<{ id: string; payload: string; owner: string }>(
      `SELECT s.id,s.payload,u.name AS owner FROM sessions s JOIN users u ON u.id=s.owner_id LEFT JOIN session_lifecycle l ON l.session_id=s.id WHERE l.deleted_at IS NULL AND (s.payload LIKE '%"status":"running"%' OR s.payload LIKE '%"status":"paused"%'${
        ids.length
          ? ` OR s.id IN (${ids.map((_, index) => `$${index + 1}`).join(",")})`
          : ""
      })`,
      ids,
    );
    const sessions: ActiveSession[] = [];
    for (const row of rows) {
      const session = JSON.parse(row.payload) as Session;
      const run = session.run;
      const entry: ActiveSession = {
        id: row.id,
        title: session.title,
        owner: row.owner,
        timer: null,
        editors: editors.get(row.id) ?? 0,
        visitorLinks: links.get(row.id) ?? 0,
      };
      if (run?.status === "running" || run?.status === "paused") {
        const day = session.days.find((value) => value.id === run.dayId);
        entry.timer = {
          status:
            run.status === "running" &&
            run.startedAt !== null &&
            run.elapsedBeforePause === 0 &&
            run.startedAt > checkedAt
              ? "scheduled"
              : run.status,
          day: day?.title ?? null,
          block:
            runnableBlocks(day?.blocks ?? []).find(
              (block) => block.id === run.blockId,
            )?.title ?? null,
          since: run.runStartedAt ?? run.startedAt,
        };
      }
      if (entry.timer || entry.editors || entry.visitorLinks)
        sessions.push(entry);
    }
    const rank = (entry: ActiveSession) =>
      entry.timer?.status === "running"
        ? 0
        : entry.timer
          ? 1
          : entry.visitorLinks
            ? 2
            : 3;
    sessions.sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.timer?.since ?? 0) - (b.timer?.since ?? 0) ||
        a.title.localeCompare(b.title),
    );
    response.json({ ...version, checkedAt, sessions });
  });
  return { linkVisited };
}
