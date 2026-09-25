export type Locale = "fr" | "en";
export type Role = "owner" | "editor" | "facilitator" | "viewer";
export type Category = string;
export const DEFAULT_CATEGORIES = [
  "opening",
  "discussion",
  "activity",
  "break",
  "decision",
  "closing",
] as const;
export interface SessionCategory {
  id: string;
  label: string;
  color: string;
}
export interface User {
  avatar?: string;
  id: string;
  name: string;
  email: string;
  locale: Locale;
  isAdmin?: boolean;
}
export interface Column {
  id: string;
  kind?: "text" | "materials" | "tasks";
  label: string;
  visibility: "team" | "public";
  visible: boolean;
}
export interface Block {
  assignees?: { id: string; name: string }[];
  id: string;
  kind?: "activity" | "note" | "group" | "parallel";
  children?: Block[];
  rooms?: Room[];
  title: string;
  description: string;
  duration: number;
  category: Category;
  facilitator: string;
  section: string;
  fields: Record<string, string>;
  lockedStart?: string;
}
interface Room {
  id: string;
  title: string;
  blocks: Block[];
}
export interface Day {
  id: string;
  title: string;
  date: string;
  startTime: string;
  blocks: Block[];
}
export interface SoundSettings {
  enabled: boolean;
  mode: "minutes" | "percent";
  value: number;
  atEnd: boolean;
  volume: number;
  sound: "bell" | "soft" | "digital";
}
export interface RunState {
  status: "idle" | "running" | "paused" | "finished";
  dayId: string;
  blockId: string | null;
  startedAt: number | null;
  elapsedBeforePause: number;
  runStartedAt: number | null;
  completedDuration: number;
  autoAdvance: boolean;
  revision: number;
  plannedDurations?: Record<string, number>;
  /** Seconds planned from the starting block to the end of the day, captured
   * at the start: removed or added blocks move the projected end against it. */
  plannedTotal?: number;
  actualDurations?: Record<string, number>;
  /** Last automatic boundary; never exposed in the visitor projection. */
  lastAutoAdvance?: {
    blockId: string;
    elapsed: number;
    actualBefore: number;
    completedBefore: number;
    endedAt: number;
  };
}
export interface Session {
  lifecycle?: import("./lifecycle.js").SessionLifecycle;
  editorLayout?: { separateDescription: boolean; separateTime: boolean };
  /** Server-owned workspace mapping, never editable through agenda PUT. */
  workspaceId?: string;
  pages?: SessionPage[];
  forms?: SessionForm[];
  contentOrder?: ContentItem[];
  id: string;
  title: string;
  description: string;
  client?: string;
  tags?: string[];
  folder?: string;
  categories?: SessionCategory[];
  timezone: string;
  ownerId: string;
  days: Day[];
  columns: Column[];
  sound: SoundSettings;
  run: RunState;
  version: number;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}
export interface SessionSummary {
  unreadActivity?: boolean;
  lastViewedAt?: string;
  closedAt?: string;
  workspaceId?: string;
  id: string;
  title: string;
  description: string;
  client?: string;
  tags?: string[];
  folder?: string;
  updatedAt: string;
  days: number;
  duration: number;
  blocks: number;
  role: Role;
  archived: boolean;
}
export interface SessionResponse {
  session: Session;
  role: Role;
}
export interface Member {
  userId: string;
  email: string;
  name: string;
  role: Role;
}
export interface Share {
  formIds?: string[];
  initialContentId?: string | null;
  enabled?: boolean;
  id: string;
  label: string;
  /** The address token, for owners; null when it cannot be read here
   * (created before addresses were kept, or imported from elsewhere). */
  token?: string | null;
  expiresAt: string | null;
  createdAt: string;
  mode?: "visitor" | "agenda";
  dayIds?: string[];
  pageIds?: string[];
  initialDayId?: string | null;
  allowComments?: boolean;
}
export interface PublicBlock extends Omit<
  Block,
  "description" | "facilitator" | "children" | "rooms" | "assignees"
> {
  description?: string;
  facilitator?: string;
  children?: PublicBlock[];
  rooms?: { id: string; title: string; blocks: PublicBlock[] }[];
}
export interface PublicDay extends Omit<Day, "blocks"> {
  blocks: PublicBlock[];
}
export interface PublicSession {
  pages?: SessionPage[];
  contentOrder?: ContentItem[];
  id: string;
  title: string;
  description: string;
  categories?: SessionCategory[];
  timezone: string;
  days: PublicDay[];
  columns: Column[];
  run: RunState;
  version: number;
}
export interface Comment {
  id: string;
  sessionId: string;
  blockId: string | null;
  author: string;
  text: string;
  createdAt: string;
}
export interface VersionSummary {
  id: string;
  createdAt: string;
  author: string;
  label: string;
}
export const DEFAULT_SOUND: SoundSettings = {
  enabled: true,
  mode: "minutes",
  value: 1,
  atEnd: true,
  volume: 0.45,
  sound: "bell",
};
export const INITIAL_RUN: RunState = {
  status: "idle",
  dayId: "",
  blockId: null,
  startedAt: null,
  elapsedBeforePause: 0,
  runStartedAt: null,
  completedDuration: 0,
  autoAdvance: false,
  revision: 0,
};
import type { ContentItem, SessionForm, SessionPage } from "./content.js";
