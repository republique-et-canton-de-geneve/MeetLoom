import { useState } from "react";
import {
  CalendarDays,
  FileText,
  GripVertical,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";
import type { Session } from "../shared/model";
import {
  newPage,
  newForm,
  orderedContent,
  type ContentItem,
} from "../shared/content";
import { useI18n } from "./i18n";

export default function SessionNavigation({
  session,
  editable,
  selected,
  onSelect,
  update,
}: {
  session: Session;
  editable: boolean;
  selected: ContentItem | null;
  onSelect: (item: ContentItem) => void;
  update: (fn: (session: Session) => Session) => void;
}) {
  const { t, locale } = useI18n(),
    items = orderedContent(session);
  // While dragging: the item moved, and where it would land if dropped now.
  const [dragging, setDragging] = useState<string | null>(null),
    [target, setTarget] = useState<{
      index: number;
      side: "before" | "after";
    } | null>(null);
  const side = (event: React.DragEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY < box.top + box.height / 2 ? "before" : "after";
  };
  const stopDragging = () => {
    setDragging(null);
    setTarget(null);
  };
  const move = (from: number, to: number) => {
    if (
      from < 0 ||
      to < 0 ||
      from >= items.length ||
      to >= items.length ||
      from === to
    )
      return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    update((current) => ({
      ...current,
      contentOrder: next,
      days: next
        .filter((item) => item.kind === "day")
        .map((item) => current.days.find((day) => day.id === item.id)!),
    }));
  };
  const add = (kind: "page" | "form") => {
    const content = kind === "page" ? newPage(locale) : newForm(locale);
    update((current) => ({
      ...current,
      ...(kind === "page"
        ? {
            pages: [
              ...(current.pages ?? []),
              content as ReturnType<typeof newPage>,
            ],
          }
        : {
            forms: [
              ...(current.forms ?? []),
              content as ReturnType<typeof newForm>,
            ],
          }),
      contentOrder: [...orderedContent(current), { kind, id: content.id }],
    }));
    onSelect({ kind, id: content.id });
  };
  return (
    <div className="session-navigation">
      <nav aria-label={t("Contenu de la séance", "Session contents")}>
        {items.map((item, index) => {
          const entry =
            item.kind === "day"
              ? session.days.find((day) => day.id === item.id)
              : item.kind === "page"
                ? session.pages?.find((page) => page.id === item.id)
                : session.forms?.find((form) => form.id === item.id);
          return (
            <div
              className={[
                "content-nav-row",
                dragging === item.id ? "dragging" : "",
                target?.index === index && dragging !== item.id
                  ? `drop-${target.side}`
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
              key={item.id}
            >
              {editable && (
                <GripVertical
                  size={13}
                  className="content-nav-grip"
                  aria-hidden="true"
                />
              )}
              <button
                className={`nav-item ${selected?.id === item.id ? "active" : ""}`}
                draggable={editable}
                title={
                  editable
                    ? t(
                        "Glissez pour réordonner (ou Alt + ↑↓)",
                        "Drag to reorder (or Alt + ↑↓)",
                      )
                    : undefined
                }
                onClick={() => onSelect(item)}
                onKeyDown={(event) => {
                  if (
                    editable &&
                    event.altKey &&
                    ["ArrowUp", "ArrowDown"].includes(event.key)
                  ) {
                    event.preventDefault();
                    move(index, index + (event.key === "ArrowUp" ? -1 : 1));
                  }
                }}
                onDragStart={(event) => {
                  event.dataTransfer.setData(
                    "application/x-meetloom-content",
                    item.id,
                  );
                  event.dataTransfer.effectAllowed = "move";
                  setDragging(item.id);
                }}
                onDragEnd={stopDragging}
                onDragOver={(event) => {
                  if (
                    editable &&
                    event.dataTransfer.types.includes(
                      "application/x-meetloom-content",
                    )
                  ) {
                    event.preventDefault();
                    const next = side(event);
                    if (target?.index !== index || target.side !== next)
                      setTarget({ index, side: next });
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from = items.findIndex(
                    (value) =>
                      value.id ===
                      event.dataTransfer.getData(
                        "application/x-meetloom-content",
                      ),
                  );
                  // The slot before or after this row, once the dragged item
                  // has left its own place.
                  let to = side(event) === "after" ? index + 1 : index;
                  if (from < to) to--;
                  stopDragging();
                  if (editable) move(from, to);
                }}
              >
                {item.kind === "day" ? (
                  <CalendarDays size={17} />
                ) : item.kind === "page" ? (
                  <FileText size={17} />
                ) : (
                  <ListChecks size={17} />
                )}
                <span>{entry?.title}</span>
              </button>
              {editable && item.kind !== "day" && (
                <button
                  className="icon-button content-nav-delete"
                  aria-label={t(
                    `Supprimer ${entry?.title}`,
                    `Delete ${entry?.title}`,
                  )}
                  onClick={() => {
                    update((current) => ({
                      ...current,
                      ...(item.kind === "page"
                        ? {
                            pages: current.pages?.filter(
                              (page) => page.id !== item.id,
                            ),
                          }
                        : {
                            forms: current.forms?.filter(
                              (form) => form.id !== item.id,
                            ),
                          }),
                      contentOrder: orderedContent(current).filter(
                        (value) => value.id !== item.id,
                      ),
                    }));
                    if (selected?.id === item.id)
                      onSelect({ kind: "day", id: session.days[0].id });
                  }}
                >
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          );
        })}
      </nav>
      {editable && (
        <div className="content-nav-add">
          <button
            disabled={(session.pages?.length ?? 0) >= 30}
            onClick={() => add("page")}
          >
            <Plus size={13} />
            {t("Page", "Page")}
          </button>
          <button
            disabled={(session.forms?.length ?? 0) >= 30}
            onClick={() => add("form")}
          >
            <Plus size={13} />
            {t("Formulaire", "Form")}
          </button>
        </div>
      )}
    </div>
  );
}
