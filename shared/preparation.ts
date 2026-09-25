import { allBlocks, mapBlocks } from "./domain.js";
import { createPresetColumn } from "./field-presets.js";
import {
  appendMaterial,
  appendTask,
  extractMaterials,
  extractTasks,
  setTaskChecked,
  type RichTask,
} from "./richtext.js";
import type { Block, Locale, Session } from "./model.js";

interface PreparationSource {
  blockId: string;
  blockTitle: string;
  columnId: string;
  columnLabel: string;
  source: string;
}
export interface PreparationTask extends PreparationSource, RichTask {}
export interface PreparationMaterial extends PreparationSource {
  text: string;
}

export function preparationForDay(
  session: Session,
  dayId: string,
): { tasks: PreparationTask[]; materials: PreparationMaterial[] } {
  const tasks: PreparationTask[] = [],
    materials: PreparationMaterial[] = [];
  const day = session.days.find((candidate) => candidate.id === dayId);
  if (!day) return { tasks, materials };
  for (const block of allBlocks(day.blocks)) {
    for (const column of session.columns) {
      if (column.id === "facilitator") continue;
      const source =
        column.id === "description"
          ? block.description
          : (block.fields[column.id] ?? "");
      const origin = {
        blockId: block.id,
        blockTitle: block.title,
        columnId: column.id,
        columnLabel: column.label,
        source,
      };
      tasks.push(
        ...extractTasks(source).map((task) => ({ ...origin, ...task })),
      );
      if (column.kind === "materials")
        materials.push(
          ...extractMaterials(source).map((text) => ({ ...origin, text })),
        );
    }
  }
  return { tasks, materials };
}

/** Refuse stale task paths instead of checking another task after a concurrent text edit. */
export function updatePreparationTask(
  session: Session,
  task: PreparationTask,
  checked: boolean,
): Session {
  let found = false;
  const days = session.days.map((day) => ({
    ...day,
    blocks: mapBlocks(day.blocks, (block) => {
      if (block.id !== task.blockId) return block;
      const current =
        task.columnId === "description"
          ? block.description
          : (block.fields[task.columnId] ?? "");
      if (current !== task.source) throw new Error("TASK_SOURCE_CHANGED");
      found = true;
      const next = setTaskChecked(current, task.path, checked);
      return task.columnId === "description"
        ? { ...block, description: next }
        : { ...block, fields: { ...block.fields, [task.columnId]: next } };
    }),
  }));
  if (!found) throw new Error("TASK_SOURCE_CHANGED");
  return { ...session, days };
}

/** New preparation items always go into an internal typed column, never an existing public one. */
export function addPreparationItem(
  session: Session,
  dayId: string,
  blockId: string,
  kind: "tasks" | "materials",
  text: string,
  locale: Locale,
): Session {
  const value = text.trim();
  if (!value || value.length > 2000)
    throw new Error("PREPARATION_TEXT_INVALID");
  const day = session.days.find((candidate) => candidate.id === dayId);
  if (!day || !allBlocks(day.blocks).some((block) => block.id === blockId))
    throw new Error("PREPARATION_BLOCK_MISSING");
  const existing = session.columns.find(
    (column) => column.kind === kind && column.visibility === "team",
  );
  if (!existing && session.columns.length >= 20)
    throw new Error("PREPARATION_COLUMN_LIMIT");
  const column = existing ?? createPresetColumn(kind, locale);
  const update = (block: Block): Block =>
    block.id === blockId
      ? {
          ...block,
          fields: {
            ...block.fields,
            [column.id]: (kind === "tasks" ? appendTask : appendMaterial)(
              block.fields[column.id] ?? "",
              value,
            ),
          },
        }
      : block;
  return {
    ...session,
    columns: existing ? session.columns : [...session.columns, column],
    days: session.days.map((item) =>
      item.id === dayId
        ? { ...item, blocks: mapBlocks(item.blocks, update) }
        : item,
    ),
  };
}
