import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { Day, Session } from "../shared/model";
import { formatTime } from "../shared/domain";
import { categoryColor } from "./categories";
import { useI18n } from "./i18n";
import { minimapItems, revealScrollTop, type MinimapItem } from "./minimap";
import TimerMinimapProgress from "./TimerMinimapProgress";
import { durationLabel } from "./ui";

/** The day to scale in the editor sidebar. Activities inside groups and
 * parallel rooms keep their own colors inside a frame shaped like the
 * agenda's, whose rail jumps to the container. While a run is live, done
 * steps fade and the current one shows its progress. */
export default function AgendaMinimap({
  session,
  day,
  onJump,
}: {
  session: Session;
  day: Day;
  onJump: (item: MinimapItem) => void;
}) {
  const { t } = useI18n();
  const items = useMemo(
    () => minimapItems(day, session.run),
    [day, session.run],
  );
  const box = useRef<HTMLDivElement>(null);
  const { run } = session;
  const currentId =
    (run.status === "running" || run.status === "paused") &&
    run.dayId === day.id
      ? run.blockId
      : null;
  // A long day scrolls: each new step is brought into view inside the
  // minimap only (scrollIntoView would also move the sidebar and the page).
  useEffect(() => {
    const view = box.current,
      current = view?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!currentId || !view || !current) return;
    const top =
      current.getBoundingClientRect().top -
      view.getBoundingClientRect().top +
      view.scrollTop;
    view.scrollTop = revealScrollTop(view, {
      top,
      bottom: top + current.offsetHeight,
    });
  }, [currentId]);
  const statusText = ({ status }: MinimapItem) =>
    status === "done"
      ? t("Terminé", "Done")
      : status === "current"
        ? run.status === "paused"
          ? t("En pause", "Paused")
          : t("En cours", "In progress")
        : "";
  const describe = (item: MinimapItem) =>
    [
      formatTime(item.startMinute),
      item.block.title,
      item.block.kind === "note"
        ? t("Note sans durée", "Untimed note")
        : durationLabel(item.minutes),
      statusText(item),
    ]
      .filter(Boolean)
      .join(" · ");
  const render = (item: MinimapItem): ReactNode => {
    const { block, minutes, status } = item,
      flex = `${minutes} 1 0`,
      jumpLabel = `${t("Aller à", "Jump to")} ${block.title}`;
    if (!block.children && block.kind !== "parallel") {
      const state = statusText(item);
      return (
        <button
          key={block.id}
          className={`minimap-leaf category-bg-${block.category} minimap-${status}`}
          style={{
            flex,
            backgroundColor: categoryColor(block.category, session.categories),
          }}
          title={describe(item)}
          aria-label={state ? `${jumpLabel}, ${state}` : jumpLabel}
          aria-current={status === "current" ? "step" : undefined}
          onClick={() => onJump(item)}
        >
          {status === "current" && (
            <TimerMinimapProgress session={session} block={block} />
          )}
          <span>{block.title}</span>
        </button>
      );
    }
    const kind = block.children ? "group" : "parallel",
      current = kind === "parallel" && status === "current";
    return (
      <div
        key={block.id}
        className={`minimap-container minimap-${kind}${current ? " minimap-current" : ""}`}
        style={{ flex }}
        role="group"
        aria-label={`${
          kind === "group"
            ? t("Groupe", "Group")
            : t("Activités en parallèle", "Parallel activities")
        } ${block.title} · ${durationLabel(minutes)}`}
      >
        <button
          className={`minimap-rail${status === "done" ? " minimap-done" : ""}`}
          title={describe(item)}
          aria-label={jumpLabel}
          aria-current={current ? "step" : undefined}
          onClick={() => onJump(item)}
        />
        {kind === "group" ? (
          <div className="minimap-list">{item.children.map(render)}</div>
        ) : (
          <div className="minimap-rooms">
            {item.rooms.map((room) => (
              <div
                className="minimap-list"
                role="group"
                aria-label={room.title}
                key={room.id}
              >
                {room.items.map(render)}
                {room.minutes < minutes && (
                  <i
                    className="minimap-spacer"
                    aria-hidden="true"
                    style={{ flex: `${minutes - room.minutes} 1 0` }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {current && (
          <TimerMinimapProgress session={session} block={block} vertical />
        )}
      </div>
    );
  };
  return (
    <div
      ref={box}
      className="agenda-minimap"
      role="navigation"
      aria-label={t("Navigation dans l’agenda", "Agenda navigation")}
    >
      {items.map(render)}
    </div>
  );
}
