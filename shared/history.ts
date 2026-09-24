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
