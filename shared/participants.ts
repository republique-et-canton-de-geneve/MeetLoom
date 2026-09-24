import type { Role } from "./model.js";
export interface Participant {
  id: string;
  name: string;
  userId?: string;
  avatar?: string;
  pending: boolean;
  role: Role;
}
export interface ParticipantInvitation {
  id: string;
  name: string;
  email: string;
  role: Exclude<Role, "owner">;
  expiresAt: string;
  active: boolean;
}
export const participantSummary = (people: { name: string }[]) =>
  people
    .map((person) => person.name)
    .join(", ")
    .slice(0, 240);
