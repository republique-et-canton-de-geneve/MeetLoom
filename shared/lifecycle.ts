import type { Role } from "./model.js";
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
