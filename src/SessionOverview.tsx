import { useState } from "react";
import {
  ArrowRight,
  CalendarDays,
  Clock3,
  Plus,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { Block, Session } from "../shared/model";
import {
  formatTime,
  newBlock,
  scheduleDay,
  totalDuration,
  blockDuration,
  allBlocks,
  cloneBlockTree,
  mapBlocks,
} from "../shared/domain";
import { useI18n } from "./i18n";
import { durationLabel } from "./ui";
import { ClockField, DurationField } from "./TimeFields";
import { LocalClock, DisplayTimeControl } from "./DisplayTime";
import { categoryColor } from "./categories";

export default function SessionOverview({
  session,
  editable,
  update,
  openDay,
}: {
  session: Session;
  editable: boolean;
  update: (fn: (s: Session) => Session) => void;
  openDay: (dayId: string, blockId?: string) => void;
}) {
  const { t, locale } = useI18n();
  const [scale, setScale] = useState(3),
    [dragged, setDragged] = useState<string | null>(null);
  const changeDay = (id: string, patch: Partial<Session["days"][number]>) =>
    update((s) => ({
      ...s,
      days: s.days.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));
  const active = ["running", "paused"].includes(session.run.status)
    ? session.run.blockId
    : null;
  const move = (dayId: string, beforeId?: string, copy = false) => {
    if (!editable || !dragged || dragged === active || dragged === beforeId)
      return;
    update((s) => {
      const block = s.days
        .flatMap((d) => d.blocks)
        .find((b) => b.id === dragged);
      if (!block) return s;
      if (allBlocks([block]).some((b) => b.id === active) && !copy) return s;
      const days = s.days.map((d) => ({
        ...d,
        blocks: copy ? d.blocks : d.blocks.filter((b) => b.id !== dragged),
      }));
      const target = days.find((d) => d.id === dayId)!;
      const at = beforeId
        ? target.blocks.findIndex((b) => b.id === beforeId)
        : target.blocks.length;
      target.blocks.splice(
        at < 0 ? target.blocks.length : at,
        0,
        copy ? cloneBlockTree(block) : block,
      );
      return { ...s, days };
    });
    setDragged(null);
  };
  return (
    <section
      className="session-overview"
      aria-label={t("Vue d’ensemble de la séance", "Session overview")}
    >
      <header className="overview-heading">
        <div>
          <span className="eyebrow">{t("VUE D’ENSEMBLE", "OVERVIEW")}</span>
          <h1>{session.title}</h1>
          <p>
            {session.days.length} {t("jour(s)", "day(s)")} ·{" "}
            {durationLabel(totalDuration(session))}
          </p>
        </div>
        <div className="button-row">
          <button
            className="icon-button"
            disabled={scale <= 1}
            title={t("Réduire", "Zoom out")}
            onClick={() => setScale((s) => s - 1)}
          >
            <ZoomOut size={19} />
          </button>
          <span>{Math.round((scale / 3) * 100)}%</span>
          <button
            className="icon-button"
            disabled={scale >= 6}
            title={t("Agrandir", "Zoom in")}
            onClick={() => setScale((s) => s + 1)}
          >
            <ZoomIn size={19} />
          </button>
        </div>
      </header>
      <DisplayTimeControl timezone={session.timezone} />
      <p className="overview-instruction">
        {t(
          "Modifiez les titres et les durées ici. Déplacez un bloc vers un autre jour pour réorganiser votre séance.",
          "Edit titles and durations here. Move a block to another day to reorganise your session.",
        )}
      </p>
      <div className="overview-days">
        {session.days.map((day) => {
          const schedule = scheduleDay(day);
          return (
            <section
              key={day.id}
              className="overview-day"
              onDragOver={(e) => {
                if (editable) e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                move(day.id, undefined, e.altKey || e.ctrlKey);
              }}
            >
              <header>
                <div className="overview-day-title">
                  <CalendarDays size={17} />
                  <input
                    aria-label={t("Nom du jour", "Day name")}
                    value={day.title}
                    maxLength={120}
                    readOnly={!editable}
                    onChange={(e) =>
                      changeDay(day.id, { title: e.target.value })
                    }
                  />
                  <button
                    className="icon-button"
                    title={t("Ouvrir ce jour", "Open this day")}
                    onClick={() => openDay(day.id)}
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
                <div className="overview-day-meta">
                  <input
                    type="date"
                    aria-label={t("Date", "Date")}
                    value={day.date}
                    readOnly={!editable}
                    onChange={(e) => {
                      if (e.target.value)
                        changeDay(day.id, { date: e.target.value });
                    }}
                  />
                  <ClockField
                    value={day.startTime}
                    label={t("Heure de début", "Start time")}
                    readOnly={!editable}
                    change={(value) => changeDay(day.id, { startTime: value })}
                  />
                </div>
              </header>
              <div className="overview-day-track">
                {schedule.map(
                  ({ block, startMinute, gapMinutes, conflict }) => (
                    <div
                      key={block.id}
                      className={`overview-block category-${block.category} ${conflict ? "schedule-conflict" : ""}`}
                      style={{
                        borderLeftColor: categoryColor(
                          block.category,
                          session.categories,
                        ),
                        minHeight: Math.max(92, blockDuration(block) * scale),
                      }}
                      draggable={
                        editable &&
                        !allBlocks([block]).some((b) => b.id === active)
                      }
                      onDragStart={(e) => {
                        setDragged(block.id);
                        e.dataTransfer.setData("text/plain", block.id);
                        e.dataTransfer.effectAllowed = "copyMove";
                      }}
                      onDragEnd={() => setDragged(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        move(day.id, block.id, e.altKey || e.ctrlKey);
                      }}
                    >
                      <div className="overview-block-meta">
                        <span>{formatTime(startMinute)}</span>
                        <LocalClock
                          minute={startMinute}
                          date={day.date}
                          timezone={session.timezone}
                        />
                        {gapMinutes > 0 && (
                          <span>+{durationLabel(gapMinutes)}</span>
                        )}
                        <button
                          className="icon-button"
                          title={t("Ouvrir ce bloc", "Open this block")}
                          onClick={() => openDay(day.id, block.id)}
                        >
                          <ArrowRight size={15} />
                        </button>
                      </div>
                      <input
                        className="overview-block-title"
                        aria-label={t("Titre du bloc", "Block title")}
                        value={block.title}
                        maxLength={240}
                        readOnly={!editable}
                        onChange={(e) =>
                          changeDay(day.id, {
                            blocks: day.blocks.map((b) =>
                              b.id === block.id
                                ? { ...b, title: e.target.value }
                                : b,
                            ),
                          })
                        }
                      />
                      <DurationField
                        value={blockDuration(block)}
                        label={`${t("Durée de", "Duration of")} ${block.title}`}
                        readOnly={
                          !editable ||
                          ["note", "group", "parallel"].includes(
                            block.kind ?? "",
                          )
                        }
                        change={(duration) =>
                          changeDay(day.id, {
                            blocks: day.blocks.map((b) =>
                              b.id === block.id ? { ...b, duration } : b,
                            ),
                          })
                        }
                      />
                      {block.facilitator && <small>{block.facilitator}</small>}
                      {(block.kind === "group" ||
                        block.kind === "parallel") && (
                        <OverviewChildren
                          block={block}
                          editable={editable}
                          scale={scale}
                          open={(id) => openDay(day.id, id)}
                          change={(id, patch) =>
                            changeDay(day.id, {
                              blocks: mapBlocks(day.blocks, (value) =>
                                value.id === id
                                  ? { ...value, ...patch }
                                  : value,
                              ),
                            })
                          }
                        />
                      )}
                    </div>
                  ),
                )}
                {editable && (
                  <button
                    className="overview-add"
                    onClick={() => {
                      const block = newBlock(locale);
                      changeDay(day.id, { blocks: [...day.blocks, block] });
                    }}
                  >
                    <Plus size={16} />
                    {t("Ajouter un bloc", "Add block")}
                  </button>
                )}
              </div>
              <footer>
                <Clock3 size={14} />
                {durationLabel(
                  day.blocks.reduce((n, b) => n + blockDuration(b), 0),
                )}
                <span>
                  {schedule.length
                    ? formatTime(schedule.at(-1)!.endMinute)
                    : day.startTime}
                </span>
              </footer>
            </section>
          );
        })}
      </div>
    </section>
  );
}

function OverviewChildren({
  block,
  editable,
  scale,
  change,
  open,
}: {
  block: Block;
  editable: boolean;
  scale: number;
  change: (id: string, patch: Partial<Block>) => void;
  open: (id: string) => void;
}) {
  const { t } = useI18n(),
    [selectedRoom, setSelectedRoom] = useState("");
  const items = (blocks: Block[]) =>
    blocks.map((child) => (
      <div
        key={child.id}
        className="overview-child"
        style={{ minHeight: Math.max(70, blockDuration(child) * scale) }}
        onDragStart={(event) => event.stopPropagation()}
        draggable={false}
      >
        <input
          aria-label={t("Titre du bloc imbriqué", "Nested block title")}
          readOnly={!editable}
          value={child.title}
          maxLength={200}
          onChange={(event) => change(child.id, { title: event.target.value })}
        />
        <div className="overview-child-controls">
          <DurationField
            value={blockDuration(child)}
            label={`${t("Durée de", "Duration of")} ${child.title}`}
            readOnly={
              !editable ||
              ["group", "parallel", "note"].includes(child.kind ?? "")
            }
            change={(duration) => change(child.id, { duration })}
          />
          <button
            className="icon-button"
            title={`${t("Ouvrir", "Open")} ${child.title}`}
            onClick={() => open(child.id)}
          >
            <ArrowRight size={14} />
          </button>
        </div>
        {(child.kind === "group" || child.kind === "parallel") && (
          <OverviewChildren
            block={child}
            editable={editable}
            scale={scale}
            change={change}
            open={open}
          />
        )}
      </div>
    ));
  if (block.kind === "parallel")
    return (
      <div className="overview-rooms">
        <select
          aria-label={t("Salle affichée", "Displayed room")}
          value={selectedRoom}
          onChange={(event) => setSelectedRoom(event.target.value)}
        >
          <option value="">{t("Toutes les salles", "All rooms")}</option>
          {block.rooms?.map((room) => (
            <option key={room.id} value={room.id}>
              {room.title}
            </option>
          ))}
        </select>
        <div className="overview-room-grid">
          {block.rooms
            ?.filter((room) => !selectedRoom || room.id === selectedRoom)
            .map((room) => {
              const duration = room.blocks.reduce(
                  (sum, child) => sum + blockDuration(child),
                  0,
                ),
                remaining = blockDuration(block) - duration;
              return (
                <section className="overview-room" key={room.id}>
                  <strong>{room.title}</strong>
                  {items(room.blocks)}
                  {remaining > 0 && (
                    <div
                      className="overview-room-gap"
                      style={{ minHeight: Math.max(32, remaining * scale) }}
                    >
                      {durationLabel(remaining)} {t("disponibles", "available")}
                    </div>
                  )}
                </section>
              );
            })}
        </div>
      </div>
    );
  return (
    <div className="overview-group-children">{items(block.children ?? [])}</div>
  );
}
