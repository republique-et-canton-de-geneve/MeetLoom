import { useState, type ReactNode } from "react";
import {
  ArrowUp,
  ArrowDown,
  Copy,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import {
  DEFAULT_CATEGORIES,
  type Block,
  type Column,
  type SessionCategory,
} from "../shared/model";
import {
  allBlocks,
  blockDuration,
  mapBlocks,
  newBlock,
} from "../shared/domain";
import { blockSchema } from "../shared/validation";
import { useI18n } from "./i18n";
import AssigneePicker from "./AssigneePicker";
import { DurationField } from "./TimeFields";
import { RichTextEditor } from "./RichTextEditor";
import {
  duplicateBlockInTree,
  moveBlockInTree,
  moveBlockToList,
  removeBlockFromTree,
} from "./block-tree";

export interface GroupEditorProps {
  block: Block;
  onChange: (block: Block) => void;
  disabled?: boolean;
  columns?: Column[];
  categories?: SessionCategory[];
  activeBlockId?: string | null;
}

/** A self-contained tree inspector; the parent owns persistence and undo. */
export default function GroupEditor({
  block,
  onChange,
  disabled = false,
  columns = [],
  categories = [],
  activeBlockId = null,
}: GroupEditorProps) {
  const { t, locale } = useI18n();
  const [error, setError] = useState("");
  const structural = (next: Block) => {
    const checked = blockSchema.safeParse(next);
    if (!checked.success) {
      setError(
        t(
          "Cette structure dépasse les limites : 5 niveaux, 1000 blocs, 12 salles et 24 h par groupe. Complétez aussi les titres vides.",
          "This structure exceeds the limits: 5 levels, 1000 blocks, 12 rooms and 24 hours per group. Complete empty titles as well.",
        ),
      );
      return;
    }
    setError("");
    onChange(checked.data);
  };
  const edit = (id: string, patch: Partial<Block>) =>
    onChange(
      mapBlocks([block], (child) =>
        child.id === id ? { ...child, ...patch } : child,
      )[0],
    );
  const containsActive = (value: Block) =>
    !!activeBlockId &&
    allBlocks([value]).some((child) => child.id === activeBlockId);
  const targets = allBlocks([block]).flatMap((value) => [
    ...(value.kind === "group" ? [{ id: value.id, title: value.title }] : []),
    ...(value.rooms ?? []).map((room) => ({
      id: room.id,
      title: `${value.title} · ${room.title}`,
    })),
  ]);
  const changeList = (listId: string, update: (children: Block[]) => Block[]) =>
    structural(
      mapBlocks([block], (child) => {
        if (child.kind === "group" && child.id === listId)
          return { ...child, children: update(child.children ?? []) };
        if (child.rooms)
          return {
            ...child,
            rooms: child.rooms.map((room) =>
              room.id === listId
                ? { ...room, blocks: update(room.blocks) }
                : room,
            ),
          };
        return child;
      })[0],
    );
  const add = (listId: string, kind: NonNullable<Block["kind"]>) => {
    const child = newBlock(locale, {
      kind,
      title:
        kind === "note"
          ? t("Nouvelle note", "New note")
          : kind === "group"
            ? t("Nouveau groupe", "New group")
            : kind === "parallel"
              ? t("Activités en parallèle", "Parallel activities")
              : t("Nouvelle activité", "New activity"),
      ...(kind === "parallel"
        ? {
            rooms: [1, 2].map((index) => ({
              id: crypto.randomUUID(),
              title: `${t("Salle", "Room")} ${index}`,
              blocks: [],
            })),
          }
        : {}),
    });
    changeList(listId, (children) => [...children, child]);
  };
  const renderList = (children: Block[], listId: string, depth: number) => (
    <div
      className="group-editor-list"
      onDragOver={(event) => {
        if (
          !disabled &&
          event.dataTransfer.types.includes("application/x-meetloom-block")
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onDrop={(event) => {
        if (disabled) return;
        const id = event.dataTransfer.getData("application/x-meetloom-block");
        if (id) {
          event.preventDefault();
          event.stopPropagation();
          structural(moveBlockToList(block, id, listId));
        }
      }}
    >
      {children.map((child, index) => (
        <details key={child.id} className="group-editor-child">
          <summary>
            <span
              draggable={!disabled}
              onDragStart={(event) => {
                event.stopPropagation();
                event.dataTransfer.setData(
                  "application/x-meetloom-block",
                  child.id,
                );
                event.dataTransfer.effectAllowed = "move";
              }}
              aria-hidden="true"
            >
              <GripVertical size={14} />
            </span>
            <span>{child.title || t("Sans titre", "Untitled")}</span>
            <small>{Math.floor(blockDuration(child) + 1e-9)} min</small>
          </summary>
          <div className="group-editor-fields">
            <label>
              {t("Titre", "Title")}
              <input
                value={child.title}
                disabled={disabled}
                maxLength={240}
                onChange={(event) =>
                  edit(child.id, { title: event.target.value })
                }
              />
            </label>
            <div className="group-editor-actions">
              <button
                type="button"
                className="icon-button"
                title={t("Monter", "Move up")}
                disabled={disabled || index === 0}
                onClick={() =>
                  structural(moveBlockInTree([block], child.id, -1)[0])
                }
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                title={t("Descendre", "Move down")}
                disabled={disabled || index === children.length - 1}
                onClick={() =>
                  structural(moveBlockInTree([block], child.id, 1)[0])
                }
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                className="icon-button"
                title={t("Dupliquer", "Duplicate")}
                disabled={disabled}
                onClick={() =>
                  structural(duplicateBlockInTree([block], child.id)[0])
                }
              >
                <Copy size={15} />
              </button>
              <button
                type="button"
                className="icon-button danger"
                title={
                  containsActive(child)
                    ? t(
                        "Arrêtez le minuteur avant de supprimer ce bloc",
                        "Stop the timer before deleting this block",
                      )
                    : t("Supprimer", "Delete")
                }
                disabled={disabled || containsActive(child)}
                onClick={() =>
                  structural(removeBlockFromTree([block], child.id)[0])
                }
              >
                <Trash2 size={15} />
              </button>
            </div>
            {(child.kind === undefined || child.kind === "activity") && (
              <DurationField
                value={child.duration}
                change={(duration) => edit(child.id, { duration })}
                label={t("Durée du bloc", "Block duration")}
                readOnly={disabled}
              />
            )}
            {child.kind === "note" && (
              <p className="muted">
                {t(
                  "Note sans durée, ignorée par le minuteur.",
                  "Untimed note, skipped by the timer.",
                )}
              </p>
            )}
            <label>
              {t("Description", "Description")}
              <RichTextEditor
                value={child.description}
                onChange={(description) => edit(child.id, { description })}
                disabled={disabled}
                ariaLabel={t("Description du bloc", "Block description")}
              />
            </label>
            <label>
              {t("Intervenant", "Facilitator")}
              <AssigneePicker
                block={child}
                change={(patch) => edit(child.id, patch)}
                disabled={disabled}
              />
            </label>
            <label>
              {t("Catégorie", "Category")}
              <select
                value={child.category}
                disabled={disabled}
                onChange={(event) =>
                  edit(child.id, { category: event.target.value })
                }
              >
                {DEFAULT_CATEGORIES.map((id) => (
                  <option key={id} value={id}>
                    {
                      {
                        opening: t("Ouverture", "Opening"),
                        discussion: t("Discussion", "Discussion"),
                        activity: t("Activité", "Activity"),
                        break: t("Pause", "Break"),
                        decision: t("Décision", "Decision"),
                        closing: t("Clôture", "Closing"),
                      }[id]
                    }
                  </option>
                ))}
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Heure verrouillée", "Locked start")}
              <input
                type="time"
                value={child.lockedStart ?? ""}
                disabled={disabled}
                onChange={(event) => {
                  const updated = { ...child };
                  if (event.target.value)
                    updated.lockedStart = event.target.value;
                  else delete updated.lockedStart;
                  onChange(
                    mapBlocks([block], (value) =>
                      value.id === child.id ? updated : value,
                    )[0],
                  );
                }}
              />
            </label>
            {columns
              .filter(
                (column) => !["description", "facilitator"].includes(column.id),
              )
              .map((column) => (
                <label key={column.id}>
                  {column.label}
                  {column.visibility === "team"
                    ? ` · ${t("Équipe", "Team")}`
                    : ""}
                  <RichTextEditor
                    value={child.fields[column.id] ?? ""}
                    onChange={(value) =>
                      edit(child.id, {
                        fields: { ...child.fields, [column.id]: value },
                      })
                    }
                    disabled={disabled}
                    ariaLabel={column.label}
                  />
                </label>
              ))}
            {!disabled && (
              <label>
                {t("Déplacer vers", "Move to")}
                <select
                  value=""
                  onChange={(event) => {
                    if (event.target.value)
                      structural(
                        moveBlockToList(block, child.id, event.target.value),
                      );
                  }}
                >
                  <option value="">
                    {t(
                      "Choisir un groupe ou une salle…",
                      "Choose a group or room…",
                    )}
                  </option>
                  {targets
                    .filter(
                      (target) =>
                        target.id !== listId &&
                        !allBlocks([child]).some(
                          (value) =>
                            value.id === target.id ||
                            value.rooms?.some((room) => room.id === target.id),
                        ),
                    )
                    .map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.title}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {renderContainer(child, depth)}
          </div>
        </details>
      ))}
      {!disabled && depth <= 5 && (
        <div className="group-editor-add">
          <button
            type="button"
            className="button small"
            onClick={() => add(listId, "activity")}
          >
            <Plus size={14} />
            {t("Activité", "Activity")}
          </button>
          <button
            type="button"
            className="button small"
            onClick={() => add(listId, "note")}
          >
            {t("Note", "Note")}
          </button>
          {depth < 5 && (
            <>
              <button
                type="button"
                className="button small"
                onClick={() => add(listId, "group")}
              >
                {t("Groupe", "Group")}
              </button>
              <button
                type="button"
                className="button small"
                onClick={() => add(listId, "parallel")}
              >
                {t("Parallèle", "Parallel")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
  const renderContainer = (value: Block, depth: number): ReactNode => {
    if (value.kind === "group")
      return renderList(value.children ?? [], value.id, depth + 1);
    if (value.kind !== "parallel") return null;
    return (
      <div className="group-editor-rooms">
        {(value.rooms ?? []).map((room, index) => (
          <section key={room.id} className="group-editor-room">
            <div className="group-editor-room-heading">
              <input
                aria-label={t("Nom de la salle", "Room name")}
                value={room.title}
                disabled={disabled}
                maxLength={120}
                onChange={(event) =>
                  edit(value.id, {
                    rooms: value.rooms!.map((item) =>
                      item.id === room.id
                        ? { ...item, title: event.target.value }
                        : item,
                    ),
                  })
                }
              />
              <span>
                {room.blocks.reduce(
                  (sum, child) => sum + blockDuration(child),
                  0,
                )}{" "}
                min
              </span>
              <button
                type="button"
                className="icon-button"
                disabled={disabled || index === 0}
                title={t("Déplacer la salle vers le haut", "Move room up")}
                onClick={() => {
                  const rooms = [...value.rooms!];
                  [rooms[index - 1], rooms[index]] = [
                    rooms[index],
                    rooms[index - 1],
                  ];
                  edit(value.id, { rooms });
                }}
              >
                <ArrowUp size={14} />
              </button>
              <button
                type="button"
                className="icon-button danger"
                title={t("Supprimer cette salle", "Delete this room")}
                disabled={disabled || room.blocks.some(containsActive)}
                onClick={() =>
                  edit(value.id, {
                    rooms: value.rooms!.filter((item) => item.id !== room.id),
                  })
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
            {renderList(room.blocks, room.id, depth + 1)}
          </section>
        ))}
        {!disabled && (value.rooms?.length ?? 0) < 12 && (
          <button
            type="button"
            className="button small"
            onClick={() =>
              edit(value.id, {
                rooms: [
                  ...(value.rooms ?? []),
                  {
                    id: crypto.randomUUID(),
                    title: `${t("Salle", "Room")} ${(value.rooms?.length ?? 0) + 1}`,
                    blocks: [],
                  },
                ],
              })
            }
          >
            <Plus size={14} />
            {t("Ajouter une salle", "Add room")}
          </button>
        )}
      </div>
    );
  };
  return (
    <div className="group-editor">
      <p className="muted">
        {block.kind === "parallel"
          ? t(
              "Les salles commencent ensemble. La durée est celle de la salle la plus longue. Le minuteur linéaire ne prend pas en charge les salles parallèles.",
              "Rooms start together. Duration follows the longest room. The linear timer does not support parallel rooms.",
            )
          : t(
              "Les activités du groupe se suivent ; leurs durées s’additionnent. Glissez un bloc vers un groupe ou une salle pour le déplacer.",
              "Group activities run in sequence and their durations add up. Drag a block into a group or room to move it.",
            )}
      </p>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {renderContainer(block, 1)}
    </div>
  );
}
