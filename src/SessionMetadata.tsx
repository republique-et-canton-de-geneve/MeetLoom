import { useEffect, useState } from "react";
import { Folder, Tag, Building2 } from "lucide-react";
import type { Session } from "../shared/model";
import { useI18n } from "./i18n";

export default function SessionMetadata({
  session,
  editable,
  update,
}: {
  session: Session;
  editable: boolean;
  update: (fn: (s: Session) => Session) => void;
}) {
  const { t } = useI18n();
  const [tags, setTags] = useState((session.tags ?? []).join(", ")),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setTags((session.tags ?? []).join(", "));
  }, [session.tags, editing]);
  return (
    <div className="session-metadata">
      <label>
        <Building2 size={14} />
        <input
          aria-label={t("Client ou équipe", "Client or team")}
          placeholder={t("Client ou équipe", "Client or team")}
          value={session.client ?? ""}
          maxLength={240}
          readOnly={!editable}
          onChange={(e) => update((s) => ({ ...s, client: e.target.value }))}
        />
      </label>
      <label>
        <Tag size={14} />
        <input
          aria-label={t(
            "Tags séparés par des virgules",
            "Comma-separated tags",
          )}
          placeholder={t("Ajouter des tags…", "Add tags…")}
          value={tags}
          maxLength={1600}
          readOnly={!editable}
          onFocus={() => setEditing(true)}
          onChange={(e) => setTags(e.target.value)}
          onBlur={() => {
            if (editable)
              update((s) => ({
                ...s,
                tags: [
                  ...new Set(
                    tags
                      .split(",")
                      .map((tag) => tag.trim().slice(0, 80))
                      .filter(Boolean),
                  ),
                ].slice(0, 20),
              }));
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </label>
      <label>
        <Folder size={14} />
        <input
          aria-label={t("Dossier", "Folder")}
          placeholder={t("Dossier / sous-dossier", "Folder / subfolder")}
          value={session.folder ?? ""}
          maxLength={240}
          readOnly={!editable}
          onChange={(e) => update((s) => ({ ...s, folder: e.target.value }))}
        />
      </label>
    </div>
  );
}
