import { useEffect, useRef, useState } from "react";
import { UserRoundPlus, X } from "lucide-react";
import type { Block } from "../shared/model";
import { participantSummary } from "../shared/participants";
import { useParticipants } from "./MentionContext";
import { useI18n } from "./i18n";
import { Avatar } from "./ui";
import "./participants.css";

export default function AssigneePicker({
  block,
  change,
  disabled = false,
}: {
  block: Block;
  change: (patch: Partial<Block>) => void;
  disabled?: boolean;
}) {
  const { participants } = useParticipants(),
    { t } = useI18n(),
    ref = useRef<HTMLDetailsElement>(null),
    [open, setOpen] = useState(false),
    selected = block.assignees ?? [];
  // A click or a tap anywhere else closes the menu, like other menus.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const apply = (assignees: NonNullable<Block["assignees"]>) =>
    change({ assignees, facilitator: participantSummary(assignees) });
  const avatars = (
    <span className="assignee-avatars">
      {selected.slice(0, 4).map((person) => {
        const participant = participants.find(
          (value) => value.id === person.id,
        );
        return (
          <span key={person.id} title={participant?.name ?? person.name}>
            {participant?.avatar ? (
              <img src={participant.avatar} alt="" />
            ) : (
              <Avatar name={participant?.name ?? person.name} small />
            )}
          </span>
        );
      })}
      {selected.length > 4 && (
        <span className="assignee-extra">+{selected.length - 4}</span>
      )}
    </span>
  );
  if (disabled)
    return (
      <span className="assignee-readonly">
        {avatars}
        <span>{block.facilitator || "—"}</span>
      </span>
    );
  return (
    <details
      ref={ref}
      className="assignee-picker"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          if (ref.current) ref.current.open = false;
        }
      }}
    >
      <summary
        aria-label={t("Attribuer les animateurs", "Assign facilitators")}
      >
        {selected.length ? avatars : <UserRoundPlus size={16} />}
        <span>
          {selected.length
            ? t(
                `${selected.length} personne(s)`,
                `${selected.length} person(s)`,
              )
            : block.facilitator || t("Attribuer", "Assign")}
        </span>
      </summary>
      <div className="assignee-menu">
        <strong>{t("Animateurs de ce bloc", "Block facilitators")}</strong>
        {selected.length > 0 && (
          <div className="assignee-selected">
            {selected.map((person) => (
              <button
                key={person.id}
                type="button"
                title={t("Retirer cette attribution", "Remove assignment")}
                onClick={() =>
                  apply(selected.filter((value) => value.id !== person.id))
                }
              >
                {person.name}
                <X size={12} />
              </button>
            ))}
          </div>
        )}
        {participants.map((person) => (
          <label key={person.id}>
            <input
              type="checkbox"
              checked={selected.some((value) => value.id === person.id)}
              disabled={
                selected.length >= 20 &&
                !selected.some((value) => value.id === person.id)
              }
              onChange={(event) =>
                apply(
                  event.target.checked
                    ? [...selected, { id: person.id, name: person.name }]
                    : selected.filter((value) => value.id !== person.id),
                )
              }
            />
            {person.avatar ? (
              <img src={person.avatar} alt="" />
            ) : (
              <Avatar name={person.name} small />
            )}
            <span>
              {person.name}
              {person.pending && (
                <small>
                  {t("Invitation en attente", "Invitation pending")}
                </small>
              )}
            </span>
          </label>
        ))}
        {!participants.length && (
          <p className="muted">
            {t(
              "Aucun collaborateur disponible. Invitez une personne depuis Partager.",
              "No collaborators available. Invite someone from Share.",
            )}
          </p>
        )}
        <label className="assignee-free-label">
          {t(
            "Nom libre (sans attribution de compte)",
            "Free text name (without account assignment)",
          )}
          <input
            type="text"
            maxLength={240}
            value={selected.length ? "" : block.facilitator}
            placeholder={t("Équipe, intervenant…", "Team, speaker…")}
            onChange={(event) =>
              change({ assignees: [], facilitator: event.target.value })
            }
          />
        </label>
      </div>
    </details>
  );
}
