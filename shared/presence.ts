import type { Role } from "./model.js";
export interface PresentParticipant {
  userId: string;
  name: string;
  role: Role;
  blockId: string | null;
  editing: boolean;
  lastSeen: number;
  devices: number;
}
export interface PresenceResponse {
  participants: PresentParticipant[];
  serverTime: number;
  expiresInMs: number;
}
