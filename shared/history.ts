import type { Session, VersionSummary } from "./model.js";

export interface NamedVersion extends VersionSummary {
  description: string;
  named: boolean;
  revision: number;
  sessionVersion?: number;
}
export interface VersionPreview {
  version: NamedVersion;
  session: Session;
}
export type HistoryElementKind = "session" | "day" | "block" | "page" | "form";
export interface HistoryChange {
  kind: HistoryElementKind;
  id: string;
  title: string;
  action: "added" | "changed" | "deleted" | "moved";
  fields: { field: string; before: string; after: string }[];
}
export interface JournalEntry {
  id: string;
  author: string;
  createdAt: string;
  label: string;
  sessionVersion: number;
  changes: HistoryChange[];
  omittedChanges: number;
}
export interface DeletedElement {
  id: string;
  kind: Exclude<HistoryElementKind, "session">;
  title: string;
  author: string;
  deletedAt: string;
  expiresAt: string;
  location: string;
  originalDayId?: string;
}
/** One finished run of a day: the plan it started from and the time actually
 * spent, in seconds. The first run of a day keeps the initial plan. */
export interface RunRecord {
  id: string;
  dayId: string;
  dayTitle: string;
  startedAt: string;
  finishedAt: string;
  /** Timed steps in order. */
  blocks: { id: string; title: string; planned: number; actual: number }[];
  /** Planned seconds per block, activities inside parallel rooms included:
   * what "restore this plan" puts back. */
  plan: Record<string, number>;
}
