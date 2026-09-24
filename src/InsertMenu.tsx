import { useEffect, useRef, useState } from "react";
import { Columns3, FolderTree, Plus, Square, StickyNote } from "lucide-react";
import { useI18n } from "./i18n";

export type InsertKind = "activity" | "group" | "note" | "parallel";

/** Thin line between two agenda rows: hovering shows a "+" that opens a menu
 * to insert a block, a group, a note or parallel activities at that spot. */
export default function InsertMenu({
  pick,
}: {
  pick: (kind: InsertKind) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  const options: [InsertKind, typeof Square, string, string][] = [
    [
      "activity",
      Square,
      t("Bloc", "Block"),
      t("Une activité de la séance", "An activity of the session"),
    ],
    [
      "group",
      FolderTree,
      t("Groupe", "Group"),
      t("Regrouper des activités", "Group activities together"),
    ],
    [
      "note",
      StickyNote,
      t("Note", "Note"),
      t("Annoter la séance, sans durée", "Annotate the session, untimed"),
    ],
    [
      "parallel",
      Columns3,
      t("Activités en parallèle", "Parallel activities"),
      t("Plusieurs salles en même temps", "Several rooms at the same time"),
    ],
  ];
  return (
    <div className={`insert-slot ${open ? "open" : ""}`} ref={root}>
      <button
        type="button"
        className="insert-slot-button"
        aria-expanded={open}
        aria-label={t("Insérer ici", "Insert here")}
        title={t("Insérer ici", "Insert here")}
        onClick={() => setOpen(!open)}
      >
        <Plus size={14} />
      </button>
      {open && (
        <div className="insert-menu" role="menu">
          {options.map(([kind, Icon, title, hint]) => (
            <button
              key={kind}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                pick(kind);
              }}
            >
              <Icon size={17} />
              <span>
                <strong>{title}</strong>
                <small>{hint}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
