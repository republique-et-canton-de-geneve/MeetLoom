import { useState } from "react";
import { ClipboardCheck, Package, Plus } from "lucide-react";
import type { Session } from "../shared/model";
import { allBlocks } from "../shared/domain";
import {
  addPreparationItem,
  preparationForDay,
  updatePreparationTask,
} from "../shared/preparation";
import { Inspector, ErrorBanner } from "./ui";
import { useI18n } from "./i18n";
import "./richtext.css";

export interface TasksMaterialsPanelProps {
  session: Session;
  dayId: string;
  editable: boolean;
  update: (change: (session: Session) => Session) => void;
  close: () => void;
  onSelectBlock?: (blockId: string) => void;
}
export function TasksMaterialsPanel({
  session,
  dayId,
  editable,
  update,
  close,
  onSelectBlock,
}: TasksMaterialsPanelProps) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState<"tasks" | "materials">("tasks");
  const [filter, setFilter] = useState<"all" | "open" | "done">("all");
  const [alphabetical, setAlphabetical] = useState(false);
  const [blockId, setBlockId] = useState(""),
    [text, setText] = useState(""),
    [error, setError] = useState("");
  const day = session.days.find((candidate) => candidate.id === dayId);
  const blocks = day ? allBlocks(day.blocks) : [];
  const selectedBlock = blocks.some((block) => block.id === blockId)
    ? blockId
    : (blocks[0]?.id ?? "");
  const content = preparationForDay(session, dayId);
  const tasks = content.tasks.filter(
    (task) => filter === "all" || task.checked === (filter === "done"),
  );
  const materials = alphabetical
    ? [...content.materials].sort((a, b) =>
        a.text.localeCompare(b.text, locale),
      )
    : content.materials;
  const fail = (cause: unknown) =>
    setError(
      cause instanceof Error && cause.message === "TASK_SOURCE_CHANGED"
        ? t(
            "Le contenu de cette tâche a changé. Vérifiez la liste actualisée avant de réessayer.",
            "This task's content changed. Review the updated list before retrying.",
          )
        : cause instanceof Error && cause.message === "PREPARATION_COLUMN_LIMIT"
          ? t(
              "La limite de 20 colonnes est atteinte. Transformez une colonne existante en tâches ou matériel.",
              "The 20-column limit was reached. Use an existing column for tasks or materials.",
            )
          : t(
              "Impossible d'enregistrer cet élément. Vérifiez sa longueur et le bloc sélectionné.",
              "Could not save this item. Check its length and selected block.",
            ),
    );
  return (
    <Inspector
      title={t("Tâches & matériel", "Tasks & materials")}
      subtitle={day?.title}
      close={close}
    >
      <div className="preparation-panel">
        <div className="segmented-control">
          <button
            type="button"
            className={tab === "tasks" ? "active" : ""}
            aria-pressed={tab === "tasks"}
            onClick={() => setTab("tasks")}
          >
            <ClipboardCheck size={16} /> {t("Tâches", "Tasks")} (
            {content.tasks.length})
          </button>
          <button
            type="button"
            className={tab === "materials" ? "active" : ""}
            aria-pressed={tab === "materials"}
            onClick={() => setTab("materials")}
          >
            <Package size={16} /> {t("Matériel", "Materials")} (
            {content.materials.length})
          </button>
        </div>
        {error && <ErrorBanner message={error} />}
        <div className="preparation-toolbar">
          {tab === "tasks" ? (
            <select
              value={filter}
              aria-label={t("Filtrer les tâches", "Filter tasks")}
              onChange={(event) =>
                setFilter(event.target.value as typeof filter)
              }
            >
              <option value="all">{t("Toutes les tâches", "All tasks")}</option>
              <option value="open">{t("À faire", "To do")}</option>
              <option value="done">{t("Terminées", "Completed")}</option>
            </select>
          ) : (
            <select
              value={alphabetical ? "alphabetical" : "agenda"}
              aria-label={t("Trier le matériel", "Sort materials")}
              onChange={(event) =>
                setAlphabetical(event.target.value === "alphabetical")
              }
            >
              <option value="agenda">
                {t("Ordre de l'agenda", "Agenda order")}
              </option>
              <option value="alphabetical">
                {t("Ordre alphabétique", "Alphabetical order")}
              </option>
            </select>
          )}
        </div>
        {tab === "tasks" && (
          <p className="preparation-summary">
            {content.tasks.filter((task) => task.checked).length} /{" "}
            {content.tasks.length}{" "}
            {t("terminées dans ce jour", "completed in this day")}
          </p>
        )}
        {tab === "tasks" ? (
          tasks.length ? (
            tasks.map((task) => (
              <div
                className={`preparation-item ${task.checked ? "is-complete" : ""}`}
                key={`${task.blockId}:${task.columnId}:${task.path.join(".")}`}
              >
                <input
                  type="checkbox"
                  checked={task.checked}
                  disabled={!editable}
                  aria-label={task.text}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    try {
                      update((current) =>
                        updatePreparationTask(current, task, checked),
                      );
                      setError("");
                    } catch (cause) {
                      fail(cause);
                    }
                  }}
                />
                <div>
                  <p>{task.text}</p>
                  {onSelectBlock ? (
                    <button
                      type="button"
                      className="plain-button"
                      onClick={() => onSelectBlock(task.blockId)}
                    >
                      <small>
                        {task.blockTitle} · {task.columnLabel}
                      </small>
                    </button>
                  ) : (
                    <small>
                      {task.blockTitle} · {task.columnLabel}
                    </small>
                  )}
                </div>
              </div>
            ))
          ) : (
            <p className="muted">
              {t(
                "Aucune tâche pour ce filtre. Ajoutez une liste de tâches dans les détails d'un bloc ou ci-dessous.",
                "No tasks match this filter. Add a task list in a block's details or below.",
              )}
            </p>
          )
        ) : materials.length ? (
          materials.map((item, index) => (
            <div
              className="preparation-item"
              key={`${item.blockId}:${item.columnId}:${index}`}
            >
              <Package size={16} />
              <div>
                <p>{item.text}</p>
                <small>
                  {item.blockTitle} · {item.columnLabel}
                </small>
              </div>
            </div>
          ))
        ) : (
          <p className="muted">
            {t(
              "Aucun matériel renseigné pour ce jour.",
              "No materials listed for this day.",
            )}
          </p>
        )}
        {editable && blocks.length > 0 && (
          <form
            className="preparation-add"
            onSubmit={(event) => {
              event.preventDefault();
              try {
                update((current) =>
                  addPreparationItem(
                    current,
                    dayId,
                    selectedBlock,
                    tab,
                    text,
                    locale,
                  ),
                );
                setText("");
                setError("");
              } catch (cause) {
                fail(cause);
              }
            }}
          >
            <label>
              {t("Dans le bloc", "In block")}
              <select
                value={selectedBlock}
                onChange={(event) => setBlockId(event.target.value)}
              >
                {blocks.map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.title}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {tab === "tasks"
                ? t("Nouvelle tâche", "New task")
                : t("Matériel nécessaire", "Required material")}
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={2000}
                required
                placeholder={
                  tab === "tasks"
                    ? t("Préparer les consignes…", "Prepare the instructions…")
                    : t("Feutres, tableau…", "Markers, whiteboard…")
                }
              />
            </label>
            <small className="muted">
              {t(
                "Ajout dans une colonne interne. Une colonne adaptée sera créée si nécessaire.",
                "Added to an internal column. A suitable column will be created if needed.",
              )}
            </small>
            <div className="button-row">
              <button
                type="submit"
                className="button primary"
                disabled={!text.trim()}
              >
                <Plus size={16} />
                {t("Ajouter", "Add")}
              </button>
            </div>
          </form>
        )}
      </div>
    </Inspector>
  );
}
export default TasksMaterialsPanel;
