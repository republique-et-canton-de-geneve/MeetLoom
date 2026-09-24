import { useEffect, useRef, useState, type DragEvent } from "react";
import { Copy, GripVertical, Plus, X } from "lucide-react";
import type { Session, SessionResponse, SessionSummary } from "../shared/model";
import {
  blockDuration,
  formatTime,
  newBlock,
  scheduleDay,
} from "../shared/domain";
import { api, post } from "./api";
import { DurationField } from "./TimeFields";
import { ErrorBanner } from "./ui";
import { useI18n } from "./i18n";
type Side = "left" | "right";
const transferType = "application/x-meetloom-transfer";
interface DraggedBlocks {
  side: Side;
  sessionId: string;
  dayId: string;
  blockIds: string[];
}

export default function MultiPlanView({
  session,
  editable,
  dayId,
  update,
  flush,
  reload,
  close,
  beforeLeave,
}: {
  session: Session;
  editable: boolean;
  dayId: string;
  update: (fn: (session: Session) => Session) => void;
  flush: () => Promise<Session>;
  reload: () => Promise<void>;
  close: () => void;
  beforeLeave: { current: (() => Promise<void>) | null };
}) {
  const { t, locale } = useI18n(),
    [sessions, setSessions] = useState<SessionSummary[]>([]),
    [sourceDay, setSourceDay] = useState(dayId),
    [targetId, setTargetId] = useState(""),
    [destination, setDestination] = useState<SessionResponse | null>(null),
    [targetDay, setTargetDay] = useState(""),
    [selection, setSelection] = useState<string[]>([]),
    [selectionSide, setSelectionSide] = useState<Side>("left"),
    [dropTarget, setDropTarget] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [newTitle, setNewTitle] = useState("");
  const busyRef = useRef(false),
    dragged = useRef<DraggedBlocks | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void api<{ sessions: SessionSummary[] }>("/sessions", {
      signal: abort.signal,
    })
      .then((result) =>
        setSessions(result.sessions.filter((item) => item.id !== session.id)),
      )
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [session.id]);
  useEffect(() => {
    setDestination(null);
    setDirty(false);
    if (!targetId) return;
    const abort = new AbortController();
    void api<SessionResponse>(`/sessions/${targetId}`, { signal: abort.signal })
      .then((result) => {
        setDestination(result);
        setTargetDay(result.session.days[0].id);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [targetId]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const leftDay =
      session.days.find((day) => day.id === sourceDay) ?? session.days[0],
    rightDay = destination?.session.days.find((day) => day.id === targetDay),
    rightEditable =
      !!destination &&
      !destination.session.lifecycle?.closedAt &&
      ["owner", "editor"].includes(destination.role);
  const saveRight = async () => {
    if (!destination) return null;
    if (!dirty) return destination.session;
    const saved = await api<SessionResponse>(
      `/sessions/${destination.session.id}`,
      {
        method: "PUT",
        body: JSON.stringify({
          session: destination.session,
          version: destination.session.version,
        }),
      },
    );
    setDestination(saved);
    setDirty(false);
    return saved.session;
  };
  const changeRight = (fn: (session: Session) => Session) => {
    if (!rightEditable || busyRef.current) return;
    setDestination((current) =>
      current ? { ...current, session: fn(current.session) } : null,
    );
    setDirty(true);
  };
  useEffect(() => {
    beforeLeave.current = async () => {
      if (busyRef.current)
        throw new Error(
          t(
            "Attendez la fin du transfert avant de quitter cette vue.",
            "Wait for the transfer to finish before leaving this view.",
          ),
        );
      await saveRight();
    };
    return () => {
      beforeLeave.current = null;
    };
  });
  const transfer = async (
    mode: "copy" | "move",
    scope: "blocks" | "day" | "all",
    extract = false,
    options: { side?: Side; blockIds?: string[]; beforeBlockId?: string } = {},
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const left = await flush(),
        right = extract ? null : await saveRight(),
        side = options.side ?? (scope === "blocks" ? selectionSide : "left"),
        source = side === "left" ? left : right,
        target = side === "left" ? right : left;
      if (!source) return;
      if (!extract && !target) return;
      const result = await post<{ source: Session; destination: Session }>(
        `/sessions/${source.id}/transfer`,
        {
          sourceVersion: source.version,
          dayIds:
            scope === "all"
              ? source.days.map((day) => day.id)
              : [side === "left" ? leftDay.id : targetDay],
          ...(scope === "blocks"
            ? { blockIds: options.blockIds ?? selection }
            : {}),
          mode,
          ...(extract
            ? { newTitle }
            : {
                destinationId: target!.id,
                destinationVersion: target!.version,
                ...(scope === "blocks"
                  ? {
                      destinationDayId:
                        side === "left" ? targetDay : leftDay.id,
                      destinationBeforeBlockId: options.beforeBlockId,
                    }
                  : {}),
              }),
        },
      );
      if (extract) {
        setSessions((current) => [
          {
            id: result.destination.id,
            title: result.destination.title,
            description: "",
            role: "owner",
            days: result.destination.days.length,
            blocks: 0,
            duration: 0,
            updatedAt: result.destination.updatedAt,
            archived: false,
          },
          ...current,
        ]);
        setTargetId(result.destination.id);
      } else
        setDestination((current) =>
          current
            ? {
                ...current,
                session: side === "left" ? result.destination : result.source,
              }
            : null,
        );
      setSelection([]);
      await reload();
      setNotice(
        t(
          "Contenu transféré. Les champs internes importés restent privés.",
          "Content transferred. Imported internal fields remain private.",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const acceptsDrop = (side: Side) =>
    !busyRef.current &&
    dragged.current &&
    dragged.current.side !== side &&
    (side === "left" ? editable : rightEditable);
  const dragOver = (event: DragEvent, side: Side, beforeBlockId?: string) => {
    if (!acceptsDrop(side) || !event.dataTransfer.types.includes(transferType))
      return;
    event.preventDefault();
    event.stopPropagation();
    const sourceEditable =
      dragged.current!.side === "left" ? editable : rightEditable;
    event.dataTransfer.dropEffect =
      event.ctrlKey || event.metaKey || !sourceEditable ? "copy" : "move";
    setDropTarget(`${side}:${beforeBlockId ?? "end"}`);
  };
  const drop = (event: DragEvent, side: Side, beforeBlockId?: string) => {
    if (!acceptsDrop(side)) return;
    event.preventDefault();
    event.stopPropagation();
    const item = dragged.current!;
    dragged.current = null;
    setDropTarget("");
    const source = item.side === "left" ? session : destination?.session;
    const selectedDay = item.side === "left" ? leftDay : rightDay;
    if (
      !source ||
      source.id !== item.sessionId ||
      selectedDay?.id !== item.dayId ||
      item.blockIds.some(
        (id) => !selectedDay.blocks.some((block) => block.id === id),
      )
    )
      return;
    const sourceEditable = item.side === "left" ? editable : rightEditable;
    void transfer(
      event.ctrlKey || event.metaKey || !sourceEditable ? "copy" : "move",
      "blocks",
      false,
      { side: item.side, blockIds: item.blockIds, beforeBlockId },
    );
  };
  const renderPlan = (selectedDay: Session["days"][number], side: Side) => {
    const enabled = side === "left" ? editable : rightEditable,
      change = side === "left" ? update : changeRight;
    return (
      <div
        className={`multi-plan-track ${dropTarget === `${side}:end` ? "is-drop-end" : ""}`}
        onDragOver={(event) => dragOver(event, side)}
        onDrop={(event) => drop(event, side)}
      >
        {scheduleDay(selectedDay).map(({ block, startMinute }) => (
          <div
            className={`multi-plan-block ${dropTarget === `${side}:${block.id}` ? "is-drop-before" : ""}`}
            key={block.id}
            onDragOver={(event) => dragOver(event, side, block.id)}
            onDrop={(event) => drop(event, side, block.id)}
          >
            <span>{formatTime(startMinute)}</span>
            <button
              className="icon-button multi-plan-drag"
              draggable={!busy}
              disabled={busy}
              aria-label={`${t("Glisser", "Drag")} ${block.title}`}
              title={t(
                "Glisser vers l’autre agenda ; Ctrl/⌘ pour copier",
                "Drag to the other agenda; Ctrl/⌘ to copy",
              )}
              onDragStart={(event) => {
                if (busyRef.current) {
                  event.preventDefault();
                  return;
                }
                const blockIds =
                  selectionSide === side && selection.includes(block.id)
                    ? selection.filter((id) =>
                        selectedDay.blocks.some((value) => value.id === id),
                      )
                    : [block.id];
                dragged.current = {
                  side,
                  sessionId:
                    side === "left" ? session.id : destination!.session.id,
                  dayId: selectedDay.id,
                  blockIds,
                };
                event.dataTransfer.effectAllowed = enabled
                  ? "copyMove"
                  : "copy";
                event.dataTransfer.setData(
                  transferType,
                  JSON.stringify(dragged.current),
                );
              }}
              onDragEnd={() => {
                dragged.current = null;
                setDropTarget("");
              }}
            >
              <GripVertical size={15} />
            </button>
            <input
              type="checkbox"
              aria-label={`${t("Sélectionner", "Select")} ${block.title}`}
              disabled={busy}
              checked={selectionSide === side && selection.includes(block.id)}
              onChange={(event) => {
                setSelectionSide(side);
                setSelection((current) =>
                  event.target.checked
                    ? [...(selectionSide === side ? current : []), block.id]
                    : current.filter((id) => id !== block.id),
                );
              }}
            />
            <input
              aria-label={t("Titre du bloc", "Block title")}
              value={block.title}
              readOnly={!enabled || busy}
              maxLength={240}
              onChange={(event) =>
                change((current) => ({
                  ...current,
                  days: current.days.map((day) =>
                    day.id === selectedDay.id
                      ? {
                          ...day,
                          blocks: day.blocks.map((value) =>
                            value.id === block.id
                              ? { ...value, title: event.target.value }
                              : value,
                          ),
                        }
                      : day,
                  ),
                }))
              }
            />
            <DurationField
              label={`${t("Durée de", "Duration of")} ${block.title}`}
              value={blockDuration(block)}
              readOnly={
                busy || !enabled || (!!block.kind && block.kind !== "activity")
              }
              change={(duration) =>
                change((current) => ({
                  ...current,
                  days: current.days.map((day) =>
                    day.id === selectedDay.id
                      ? {
                          ...day,
                          blocks: day.blocks.map((value) =>
                            value.id === block.id
                              ? { ...value, duration }
                              : value,
                          ),
                        }
                      : day,
                  ),
                }))
              }
            />
          </div>
        ))}
        {!selectedDay.blocks.length && (
          <p className="muted">
            {t("Aucun bloc dans ce jour.", "No blocks in this day.")}
          </p>
        )}
        {enabled && (
          <button
            className="button secondary small"
            disabled={busy}
            onClick={() =>
              change((current) => ({
                ...current,
                days: current.days.map((day) =>
                  day.id === selectedDay.id
                    ? { ...day, blocks: [...day.blocks, newBlock(locale)] }
                    : day,
                ),
              }))
            }
          >
            <Plus size={14} />
            {t("Ajouter un bloc", "Add block")}
          </button>
        )}
      </div>
    );
  };
  return (
    <section className="multi-plan-view">
      <header className="overview-heading">
        <div>
          <span className="eyebrow">{t("DEUX AGENDAS", "TWO AGENDAS")}</span>
          <h1>{t("Préparer côte à côte", "Plan side by side")}</h1>
        </div>
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setError("");
            try {
              await saveRight();
              await flush();
              close();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <X size={16} />
          {t("Revenir à la séance", "Back to session")}
        </button>
      </header>
      {error && <ErrorBanner message={error} />}{" "}
      {notice && <p role="status">{notice}</p>}
      <p className="muted multi-plan-help">
        {t(
          "Glissez la poignée vers l’autre agenda pour déplacer ; maintenez Ctrl/⌘ pour copier. Déposez sur un bloc pour insérer avant, ou en bas pour ajouter à la fin. Vous pouvez aussi cocher des blocs et utiliser les boutons ci-dessous.",
          "Drag the grip to the other agenda to move; hold Ctrl/⌘ to copy. Drop on a block to insert before it, or at the bottom to append. You can also select blocks and use the buttons below.",
        )}
      </p>
      <div className="multi-plan-columns">
        <section>
          <h2>{session.title}</h2>
          <label>
            {t("Jour source", "Source day")}
            <select
              value={leftDay.id}
              disabled={busy}
              onChange={(event) => {
                setSourceDay(event.target.value);
                setSelection([]);
              }}
            >
              {session.days.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.title}
                </option>
              ))}
            </select>
          </label>
          {renderPlan(leftDay, "left")}
          <div className="multi-plan-extract">
            <label>
              {t(
                "Extraire ce jour dans une nouvelle séance",
                "Extract this day to a new session",
              )}
              <input
                value={newTitle}
                disabled={busy}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder={t(
                  "Titre de la nouvelle séance",
                  "New session title",
                )}
                maxLength={200}
              />
            </label>
            <button
              className="button secondary"
              disabled={busy || !newTitle.trim()}
              onClick={() => void transfer("copy", "day", true)}
            >
              <Copy size={15} />
              {t("Créer la séance", "Create session")}
            </button>
          </div>
        </section>
        <section>
          <label>
            {t("Autre séance", "Other session")}
            <select
              value={targetId}
              disabled={busy || dirty}
              onChange={(event) => {
                setTargetId(event.target.value);
                setSelection([]);
              }}
            >
              <option value="">
                {t(
                  "Choisir une séance accessible",
                  "Choose an accessible session",
                )}
              </option>
              {sessions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                  {["owner", "editor"].includes(item.role)
                    ? ""
                    : ` · ${t("lecture seule", "read only")}`}
                </option>
              ))}
            </select>
          </label>
          {destination && (
            <>
              <h2>{destination.session.title}</h2>
              <label>
                {t("Jour de destination", "Destination day")}
                <select
                  value={targetDay}
                  disabled={busy}
                  onChange={(event) => {
                    setTargetDay(event.target.value);
                    setSelection([]);
                  }}
                >
                  {destination.session.days.map((day) => (
                    <option key={day.id} value={day.id}>
                      {day.title}
                    </option>
                  ))}
                </select>
              </label>
              {rightDay && renderPlan(rightDay, "right")}
              {dirty && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => {
                    if (busyRef.current) return;
                    busyRef.current = true;
                    setBusy(true);
                    void saveRight()
                      .catch((e) => setError(e.message))
                      .finally(() => {
                        busyRef.current = false;
                        setBusy(false);
                      });
                  }}
                >
                  {t("Enregistrer cet agenda", "Save this agenda")}
                </button>
              )}
              {error && dirty && (
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !confirm(
                        t(
                          "Recharger cet agenda et abandonner ses modifications locales non enregistrées ?",
                          "Reload this agenda and discard its unsaved local changes?",
                        ),
                      )
                    )
                      return;
                    busyRef.current = true;
                    setBusy(true);
                    try {
                      const current = await api<SessionResponse>(
                        `/sessions/${destination.session.id}`,
                      );
                      setDestination(current);
                      setDirty(false);
                      setError("");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      busyRef.current = false;
                      setBusy(false);
                    }
                  }}
                >
                  {t("Recharger cet agenda", "Reload this agenda")}
                </button>
              )}
            </>
          )}
        </section>
      </div>
      <footer className="multi-plan-actions">
        <span>
          {selection.length} {t("bloc(s) sélectionné(s)", "selected block(s)")}
          {selection.length > 0 && ` · ${selectionSide === "left" ? "→" : "←"}`}
        </span>
        <button
          className="button primary"
          disabled={
            busy ||
            !destination ||
            !(selectionSide === "left" ? rightEditable : editable) ||
            !selection.length
          }
          onClick={() => void transfer("copy", "blocks")}
        >
          {t("Copier les blocs", "Copy blocks")}
        </button>
        <button
          className="button secondary"
          disabled={busy || !editable || !rightEditable || !selection.length}
          onClick={() => void transfer("move", "blocks")}
        >
          {t("Déplacer les blocs", "Move blocks")}
        </button>
        <button
          className="button secondary"
          disabled={busy || !rightEditable}
          onClick={() => void transfer("copy", "day")}
        >
          {t("Copier le jour entier", "Copy whole day")}
        </button>
        <button
          className="button secondary"
          disabled={busy || !rightEditable}
          onClick={() => void transfer("copy", "all")}
        >
          {t("Fusionner tous les jours", "Merge all days")}
        </button>
      </footer>
    </section>
  );
}
