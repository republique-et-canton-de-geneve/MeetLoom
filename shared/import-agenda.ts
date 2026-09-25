import type { Block, Column, Session } from "./model.js";
import { sessionInputSchema } from "./validation.js";
import { allBlocks, mapBlocks } from "./domain.js";
import { cloneContent, contentIds, orderedContent } from "./content.js";

const builtins = ["description", "facilitator"] as const;

/** Append a validated agenda without expanding the audience of imported data. */
export function mergeImportedAgenda(
  destination: Session,
  incoming: Session,
): Session {
  const base = sessionInputSchema.parse(destination);
  const source = sessionInputSchema.parse(incoming);
  const usedIds = new Set([
    ...contentIds(base),
    ...contentIds(source),
    ...(base.categories ?? []).map((category) => category.id),
    ...(source.categories ?? []).map((category) => category.id),
    ...base.columns.map((column) => column.id),
    ...base.days.flatMap((day) => [
      day.id,
      ...allBlocks(day.blocks).flatMap((block) => [
        block.id,
        ...(block.rooms ?? []).map((room) => room.id),
      ]),
    ]),
    ...Object.keys(base.run.plannedDurations ?? {}),
    ...source.columns.map((column) => column.id),
    ...source.days.flatMap((day) => [
      day.id,
      ...allBlocks(day.blocks).flatMap((block) => [
        block.id,
        ...(block.rooms ?? []).map((room) => room.id),
      ]),
    ]),
  ]);
  const freshId = (): string => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = globalThis.crypto.randomUUID();
      if (!usedIds.has(candidate)) {
        usedIds.add(candidate);
        return candidate;
      }
    }
    throw new Error("Could not generate a unique import identifier.");
  };

  const columns: Column[] = [];
  const categoryIds = new Map<string, string>();
  const categories = (source.categories ?? []).map((category) => {
    const id = freshId();
    categoryIds.set(category.id, id);
    return { ...category, id };
  });
  if ((base.categories?.length ?? 0) + categories.length > 30)
    throw new Error("Import exceeds the limit of 30 custom categories.");
  const customIds = new Map<string, string>();
  for (const column of source.columns) {
    if (builtins.some((id) => id === column.id)) continue;
    const id = freshId();
    customIds.set(column.id, id);
    columns.push({ ...column, id, visibility: "team" });
  }

  const privateBuiltins = new Map<(typeof builtins)[number], string>();
  for (const builtin of builtins) {
    const sourceColumn = source.columns.find((column) => column.id === builtin);
    if (sourceColumn?.visibility === "public") continue;
    // A missing column grants no public access. Empty values need no extra column.
    if (
      !source.days.some((day) =>
        allBlocks(day.blocks).some((block) => block[builtin] !== ""),
      )
    )
      continue;
    const id = freshId();
    privateBuiltins.set(builtin, id);
    columns.push({
      id,
      visibility: "team",
      visible: sourceColumn?.visible ?? true,
      label:
        sourceColumn?.label ??
        base.columns.find((column) => column.id === builtin)?.label ??
        (builtin === "description"
          ? "Description"
          : "Intervenant · Facilitator"),
    });
  }

  if (base.columns.length + columns.length > 20)
    throw new Error("Import exceeds the limit of 20 columns.");
  // Imported days first fill the destination's empty days (a new session
  // starts with one), in order; the rest are added after the existing days.
  const emptyDays = base.days
    .filter((day) => !day.blocks.length)
    .map((day) => day.id)
    .slice(0, source.days.length);
  if (base.days.length + source.days.length - emptyDays.length > 30)
    throw new Error("Import exceeds the limit of 30 days.");
  if (
    [...base.days, ...source.days].reduce(
      (sum, day) => sum + allBlocks(day.blocks).length,
      0,
    ) > 1000
  ) {
    throw new Error("Import exceeds the limit of 1000 blocks.");
  }

  const dayIds = new Map(
    source.days.map((day, index) => [day.id, emptyDays[index] ?? freshId()]),
  );
  const days = source.days.map((day) => ({
    ...day,
    id: dayIds.get(day.id)!,
    blocks: mapBlocks(day.blocks, (block) => {
      const fields: Record<string, string> = Object.fromEntries(
        Object.entries(block.fields).map(([key, value]) => {
          const mappedId = customIds.get(key);
          if (!mappedId) throw new Error("Imported field has no column.");
          return [mappedId, value];
        }),
      );
      const imported: Block = {
        ...block,
        id: freshId(),
        category: categoryIds.get(block.category) ?? block.category,
        fields,
        ...(block.rooms
          ? { rooms: block.rooms.map((room) => ({ ...room, id: freshId() })) }
          : {}),
      };
      // Participant identifiers belong to the source session; keep only the protected text.
      delete (imported as Block & { assignees?: unknown }).assignees;
      for (const [builtin, columnId] of privateBuiltins) {
        fields[columnId] = block[builtin];
        imported[builtin] = "";
      }
      return imported;
    }),
  }));

  const filled = new Map(
    days
      .filter((day) => emptyDays.includes(day.id))
      .map((day) => [day.id, day.blocks]),
  );
  const added = days.filter((day) => !filled.has(day.id));
  const content = cloneContent(source, dayIds, true, freshId);
  const pages = [...(base.pages ?? []), ...(content.pages ?? [])];
  const forms = [...(base.forms ?? []), ...(content.forms ?? [])];
  // Identity, permissions, clock, sound and server revision belong to the destination.
  return sessionInputSchema.parse({
    ...base,
    ...(pages.length ? { pages } : {}),
    ...(forms.length ? { forms } : {}),
    ...(base.contentOrder || source.contentOrder
      ? {
          contentOrder: [
            ...orderedContent(base),
            ...orderedContent({ days: added, ...content }),
          ],
        }
      : {}),
    ...(base.categories || categories.length
      ? { categories: [...(base.categories ?? []), ...categories] }
      : {}),
    columns: [...base.columns, ...columns],
    days: [
      ...base.days.map((day) =>
        filled.has(day.id) ? { ...day, blocks: filled.get(day.id)! } : day,
      ),
      ...added,
    ],
  });
}
