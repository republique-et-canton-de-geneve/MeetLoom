import { Users } from "lucide-react";
import { useI18n } from "./i18n";
import { usePresence } from "./usePresence";

export default function PresenceBar({
  sessionId,
  userId,
  blockId = null,
  editing = false,
  enabled = true,
}: {
  sessionId: string;
  userId: string;
  blockId?: string | null;
  editing?: boolean;
  enabled?: boolean;
}) {
  const { t } = useI18n(),
    presence = usePresence(sessionId, { blockId, editing, enabled });
  if (!enabled) return null;
  const others = presence.participants.filter(
    (participant) => participant.userId !== userId || participant.devices > 1,
  );
  return (
    <div
      className="presence-bar"
      aria-label={t("Présence des collaborateurs", "Collaborator presence")}
    >
      <Users size={16} aria-hidden="true" />
      {!presence.connected ? (
        <span className="muted">
          {t("Présence indisponible", "Presence unavailable")}
        </span>
      ) : others.length === 0 ? (
        <span className="muted">
          {t("Vous seul sur cet agenda", "Only you in this agenda")}
        </span>
      ) : (
        <>
          {others.slice(0, 5).map((participant) => (
            <span
              key={participant.userId}
              className="presence-person"
              title={`${participant.name}${participant.userId === userId ? t(" (autre fenêtre)", " (another window)") : ""} · ${participant.editing && participant.blockId ? t("modifie un bloc", "editing a block") : t("consulte l’agenda", "viewing the agenda")}${participant.devices > 1 ? ` · ${participant.devices} ${t("fenêtres", "windows")}` : ""}`}
            >
              <span className="presence-initials">
                {participant.name
                  .trim()
                  .split(/\s+/)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <span>{participant.name}</span>
            </span>
          ))}
          {others.length > 5 && <span>+{others.length - 5}</span>}
        </>
      )}
    </div>
  );
}
