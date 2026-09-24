import type { Block, Session } from "./model.js";
import { INITIAL_RUN } from "./model.js";
import { allBlocks, mapBlocks } from "./domain.js";
import { mergeImportedAgenda } from "./import-agenda.js";
import { sessionInputSchema } from "./validation.js";
import { orderedContent } from "./content.js";

export function transferSource(
  source: Session,
  dayIds: string[],
  blockIds?: string[],
): Session {
  const wanted = new Set(blockIds),
    selected = (blocks: Block[]): Block[] =>
      blocks.flatMap((block) =>
        wanted.has(block.id)
          ? [block]
          : [
              ...selected(block.children ?? []),
              ...(block.rooms ?? []).flatMap((room) => selected(room.blocks)),
            ],
      );
  const days = source.days
    .filter((day) => dayIds.includes(day.id))
    .map((day) => ({
      ...day,
      blocks: blockIds ? selected(day.blocks) : day.blocks,
    }));
  const blocks = days.flatMap((day) => allBlocks(day.blocks)),
    fields = new Set(blocks.flatMap((block) => Object.keys(block.fields))),
    categories = new Set(blocks.map((block) => block.category));
  return {
    ...source,
    days,
    pages: [],
    forms: [],
    contentOrder: undefined,
    columns: source.columns.filter(
      (column) =>
        ["description", "facilitator"].includes(column.id) ||
        fields.has(column.id),
    ),
    categories: source.categories?.filter((category) =>
      categories.has(category.id),
    ),
  };
}
export function copyAgendaContent(
  destination: Session,
  incoming: Session,
  destinationDayId?: string,
  destinationBeforeBlockId?: string,
): Session {
  // An existing destination day consumes no additional day slot. Temporarily
  // remove the last day only at the schema's limit and restore it before final validation.
  const omitted =
    destinationDayId && destination.days.length === 30
      ? destination.days.at(-1)
      : undefined;
  const base = omitted
    ? {
        ...destination,
        days: destination.days.slice(0, -1),
        contentOrder: destination.contentOrder?.filter(
          (item) => item.id !== omitted.id,
        ),
      }
    : destination;
  const merged = mergeImportedAgenda(base, incoming);
  if (!destinationDayId) return merged;
  const added = merged.days
    .slice(base.days.length)
    .flatMap((day) => day.blocks);
  const target = destination.days.find((day) => day.id === destinationDayId);
  const before = destinationBeforeBlockId
    ? target?.blocks.findIndex((block) => block.id === destinationBeforeBlockId)
    : undefined;
  if (destinationBeforeBlockId && (before === undefined || before < 0))
    throw new Error("Destination insertion point not found");
  const days = destination.days.map((day) =>
    day.id === destinationDayId
      ? {
          ...day,
          blocks: [
            ...day.blocks.slice(0, before),
            ...added,
            ...(before === undefined ? [] : day.blocks.slice(before)),
          ],
        }
      : day,
  );
  return sessionInputSchema.parse({
    ...merged,
    days,
    contentOrder: orderedContent(destination),
  });
}
export function removeTransferredContent(
  source: Session,
  dayIds: string[],
  blockIds?: string[],
): Session {
  const ids = new Set(blockIds),
    remove = (blocks: Block[]): Block[] =>
      mapBlocks(
        blocks
          .filter((block) => !ids.has(block.id))
          .map((block) => ({
            ...block,
            ...(block.children ? { children: remove(block.children) } : {}),
            ...(block.rooms
              ? {
                  rooms: block.rooms.map((room) => ({
                    ...room,
                    blocks: remove(room.blocks),
                  })),
                }
              : {}),
          })),
        (block) => block,
      );
  const days = source.days.flatMap((day) =>
    !dayIds.includes(day.id)
      ? [day]
      : blockIds
        ? [{ ...day, blocks: remove(day.blocks) }]
        : [],
  );
  return sessionInputSchema.parse({
    ...source,
    days,
    ...(!days.some((day) => day.id === source.run.dayId) ||
    (source.run.blockId &&
      !days.some((day) =>
        allBlocks(day.blocks).some((block) => block.id === source.run.blockId),
      ))
      ? {
          run: {
            ...INITIAL_RUN,
            dayId: days[0]?.id ?? "",
            revision: source.run.revision + 1,
          },
        }
      : {}),
    contentOrder: source.contentOrder?.filter(
      (item) => item.kind !== "day" || days.some((day) => day.id === item.id),
    ),
  });
}
