import type { Role, Session } from "./model.js";
import { localDate, runnableBlocks } from "./domain.js";
export interface SessionLifecycle {
  closedAt: string;
  facilitatorIds: string[];
}
export interface LifecycleInfo {
  closedAt: string | null;
  facilitators: { id: string; name: string }[];
  collaborators: { id: string; name: string; role: Role }[];
  canClose: boolean;
  canReopen: boolean;
  canTrash: boolean;
}
export interface DeliveredSession {
  id: string;
  title: string;
  closedAt: string;
  facilitators: { id: string; name: string }[];
  tags: string[];
  plannedMinutes: number;
  actualMinutes: number | null;
  workspaceId?: string;
}
export interface TrashedSession {
  id: string;
  title: string;
  deletedAt: string;
  expiresAt: string;
  version: number;
  canRestore: boolean;
  workspaceId?: string;
}
/** Owners and editors close a session (workspace administrators and editors are editors). */
export const canCloseSession = (role: Role) =>
  role === "owner" || role === "editor";
/** Delivered but still open, so the dashboard asks whoever may close it: only
 * closed sessions count in the session report. Delivered: its timer finished
 * its last day, or that day is past in the agenda's timezone and the session
 * was created before it. A new session is dated on its creation day, a date
 * that may never have been set, and a copy keeps old dates: neither says that
 * the session took place. */
export function sessionNeedsClosing(
  session: Pick<
    Session,
    "timezone" | "archived" | "lifecycle" | "days" | "run" | "createdAt"
  >,
  role: Role,
  now: Date,
): boolean {
  const { run, days } = session;
  if (
    session.lifecycle?.closedAt ||
    session.archived ||
    !canCloseSession(role) ||
    run.status === "running" ||
    run.status === "paused" ||
    !days.some((day) => runnableBlocks(day.blocks).length)
  )
    return false;
  const dayOf = (at: Date) => {
    try {
      return localDate(at, session.timezone);
    } catch {
      return localDate(at, "UTC");
    }
  };
  const last = days.reduce((max, day) => (day.date > max ? day.date : max), "");
  const today = dayOf(now);
  if (last > today) return false;
  if (
    run.status === "finished" &&
    days.some((day) => day.id === run.dayId && day.date === last)
  )
    return true;
  const created = new Date(session.createdAt);
  return (
    last < today && (Number.isNaN(created.getTime()) || dayOf(created) < last)
  );
}
