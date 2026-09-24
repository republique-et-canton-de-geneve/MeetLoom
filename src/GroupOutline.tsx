import { ArrowRight, GripVertical, Plus, Trash2 } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type MutableRefObject,
} from "react";
import type { Block } from "../shared/model";
import { blockDuration, newBlock } from "../shared/domain";
import type { BlockDestination } from "./block-tree";
import { useI18n } from "./i18n";
import { DurationField } from "./TimeFields";
import { durationLabel } from "./ui";

/** Tree operations shared by the agenda and the blocks nested in its groups. */
export type OutlineActions = {
  change: (id: string, patch: Partial<Block>) => void;
  open: (id: string) => void;
  remove: (id: string) => void;
  insert: (block: Block, destination: BlockDestination) => void;
  relocate: (id: string, destination: BlockDestination) => void;
  /** The block being dragged, shared with the top-level agenda rows. */
  dragId: MutableRefObject<string | null>;
  /** False for the block the timer is running (it cannot move or disappear). */
  movable: (id: string) => boolean;
  /** The block shown in the details panel, highlighted in the outline. */
  inspected?: string | null;
};

export default function GroupOutline({
  block,
  editable,
  actions,
}: {
  block: Block;
  editable: boolean;
  actions: OutlineActions;
}) {
  const { t, locale } = useI18n();
  const { change, open, remove, insert, relocate, dragId, movable } = actions;
  const inputs = useRef(new Map<string, HTMLInputElement>()),
    focus = useRef<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  useLayoutEffect(() => {
    if (focus.current) {
      const input = inputs.current.get(focus.current);
      if (input) {
        input.focus();
        input.select();
        focus.current = null;
      }
    }
  });
  const addActivity = (destination: BlockDestination) => {
    const next = newBlock(locale);
    focus.current = next.id;
    insert(next, destination);
  };
  const dropHandlers = (key: string, destination: BlockDestination) =>
    editable
      ? {
          onDragOver: (event: DragEvent) => {
            if (!dragId.current) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDropTarget(key);
          },
          onDragLeave: (event: DragEvent) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node))
              setDropTarget((current) => (current === key ? null : current));
          },
          onDrop: (event: DragEvent) => {
            event.preventDefault();
            event.stopPropagation();
            setDropTarget(null);
            if (dragId.current) relocate(dragId.current, destination);
            dragId.current = null;
          },
        }
      : {};
  const list = (blocks: Block[], listId: string) => (
    <div
      className={`outline-list ${dropTarget === `end:${listId}` ? "drop-here" : ""}`}
      {...dropHandlers(`end:${listId}`, { listId })}
    >
      {blocks.map((child) => (
        <div className="group-outline-child" key={child.id}>
          <div
            className={`group-outline-row ${dropTarget === child.id ? "drop-before" : ""} ${actions.inspected === child.id ? "inspected-row" : ""}`}
            {...dropHandlers(child.id, { listId, beforeId: child.id })}
          >
            {editable && (
              <span
                className="outline-drag"
                draggable={movable(child.id)}
                title={t(
                  "Glisser pour déplacer, y compris hors du groupe",
                  "Drag to move, including out of the group",
                )}
                aria-hidden="true"
                onDragStart={(event) => {
                  event.stopPropagation();
                  dragId.current = child.id;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", child.id);
                }}
                onDragEnd={() => {
                  dragId.current = null;
                  setDropTarget(null);
                }}
              >
                <GripVertical size={14} />
              </span>
            )}
            <input
              ref={(element) => {
                if (element) inputs.current.set(child.id, element);
                else inputs.current.delete(child.id);
              }}
              aria-label={`${t("Titre du bloc dans le groupe", "Group block title")}`}
              value={child.title}
              readOnly={!editable}
              maxLength={200}
              onChange={(e) => change(child.id, { title: e.target.value })}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  editable &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  const index = blocks.findIndex(
                    (item) => item.id === child.id,
                  );
                  addActivity({ listId, beforeId: blocks[index + 1]?.id });
                }
              }}
            />
            <DurationField
              value={blockDuration(child)}
              label={`${t("Durée de", "Duration of")} ${child.title}`}
              readOnly={
                !editable ||
                ["note", "group", "parallel"].includes(child.kind ?? "")
              }
              change={(duration) => change(child.id, { duration })}
              blockId={child.id}
            />
            {editable && (
              <button
                className="icon-button outline-delete"
                title={`${t("Supprimer", "Delete")} ${child.title}`}
                aria-label={`${t("Supprimer", "Delete")} ${child.title}`}
                disabled={!movable(child.id)}
                onClick={() => remove(child.id)}
              >
                <Trash2 size={14} />
              </button>
            )}
            <button
              className="icon-button"
              title={`${t("Ouvrir", "Open")} ${child.title}`}
              onClick={() => open(child.id)}
            >
              <ArrowRight size={15} />
            </button>
          </div>
          {(child.kind === "group" || child.kind === "parallel") && (
            <GroupOutline block={child} editable={editable} actions={actions} />
          )}
        </div>
      ))}
      {editable && (
        <button className="outline-add" onClick={() => addActivity({ listId })}>
          <Plus size={14} />
          {t("Ajouter une activité", "Add an activity")}
          {!blocks.length && (
            <span>{t("ou glissez un bloc ici", "or drag a block here")}</span>
          )}
        </button>
      )}
    </div>
  );
  if (block.kind === "parallel")
    return (
      <div className="parallel-outline">
        {block.rooms?.map((room) => (
          <section key={room.id}>
            <header>
              {room.title}
              <span>
                {durationLabel(
                  room.blocks.reduce((n, b) => n + blockDuration(b), 0),
                )}
              </span>
            </header>
            {list(room.blocks, room.id)}
          </section>
        ))}
      </div>
    );
  return (
    <div className="group-outline">{list(block.children ?? [], block.id)}</div>
  );
}
