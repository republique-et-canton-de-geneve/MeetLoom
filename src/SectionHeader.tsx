import { useState, type DragEventHandler, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Ungroup } from "lucide-react";
import { useI18n } from "./i18n";

/** Heading of an agenda section: a collapse toggle, its title edited in
 * place, its time span and total duration, and a button that removes the
 * section but keeps its blocks. The title is committed on blur or Enter, so
 * it never becomes empty or merges with a neighbour while it is typed. The
 * header stays mounted when its label changes, and then shows the new one. */
export default function SectionHeader({
  label,
  span,
  duration,
  collapsed,
  editable,
  bodyId,
  toggle,
  rename,
  inputRef,
  dropProps,
}: {
  label: string;
  span: string;
  /** The planned duration, or planned against actual once played. */
  duration: ReactNode;
  collapsed: boolean;
  editable: boolean;
  bodyId: string;
  toggle: () => void;
  rename: (label: string) => void;
  inputRef: (element: HTMLInputElement | null) => void;
  dropProps: {
    onDragOver?: DragEventHandler<HTMLElement>;
    onDragLeave?: DragEventHandler<HTMLElement>;
    onDrop?: DragEventHandler<HTMLElement>;
  };
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(label);
  const [shown, setShown] = useState(label);
  // A rename, an undo or a collaborator's edit replaces the draft.
  if (shown !== label) {
    setShown(label);
    setDraft(label);
  }
  const commit = () => {
    const next = draft.trim();
    if (next && next !== label) rename(next);
    else setDraft(label);
  };
  const remove = t(
    `Retirer la section ${label} (les blocs restent dans l’agenda)`,
    `Remove the section ${label} (its blocks stay in the agenda)`,
  );
  return (
    <div className="section-header" {...dropProps}>
      <button
        className="section-toggle"
        aria-expanded={!collapsed}
        aria-controls={bodyId}
        aria-label={`${t("Développer ou replier la section", "Expand or collapse section")} ${label}`}
        onClick={toggle}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
      </button>
      <input
        className="section-title"
        ref={inputRef}
        value={draft}
        maxLength={240}
        readOnly={!editable}
        aria-label={t("Titre de la section", "Section title")}
        placeholder={t("Nom de la section", "Section name")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={editable ? commit : undefined}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") setDraft(label);
        }}
      />
      <span className="section-totals">
        {span} · {duration}
      </span>
      {editable && (
        <button
          className="icon-button section-ungroup"
          title={remove}
          aria-label={remove}
          onClick={() => rename("")}
        >
          <Ungroup size={16} />
        </button>
      )}
    </div>
  );
}
