import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Collaborator } from "../shared/comments";
import type { Participant } from "../shared/participants";
import { api } from "./api";
const MentionContext = createContext<Collaborator[]>([]);
const ParticipantsContext = createContext<{
  sessionId: string;
  participants: Participant[];
}>({ sessionId: "", participants: [] });
export const useMentionCollaborators = () => useContext(MentionContext);
export const useParticipants = () => useContext(ParticipantsContext);
export function MentionProvider({
  sessionId,
  children,
}: {
  sessionId: string;
  children: ReactNode;
}) {
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([]);
  useEffect(() => {
    const controller = new AbortController();
    setCollaborators([]);
    setParticipants([]);
    const load = () =>
      void api<{ collaborators: Collaborator[] }>(
        `/sessions/${sessionId}/collaborators`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted)
            setCollaborators(result.collaborators);
        })
        .catch(() => {
          if (!controller.signal.aborted) setCollaborators([]);
        });
    load();
    const loadParticipants = () =>
      void api<{ participants: Participant[] }>(
        `/sessions/${sessionId}/assignees`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted) setParticipants(result.participants);
        })
        .catch(() => {
          if (!controller.signal.aborted) setParticipants([]);
        });
    const refresh = () => {
      load();
      loadParticipants();
    };
    loadParticipants();
    const interval = setInterval(refresh, 30000);
    window.addEventListener("meetloom:participants", refresh);
    return () => {
      controller.abort();
      clearInterval(interval);
      window.removeEventListener("meetloom:participants", refresh);
    };
  }, [sessionId]);
  return (
    <MentionContext.Provider value={collaborators}>
      <ParticipantsContext.Provider value={{ sessionId, participants }}>
        {children}
      </ParticipantsContext.Provider>
    </MentionContext.Provider>
  );
}
