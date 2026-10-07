import type { Block } from "../shared/model";
import { allBlocks, cloneBlockTree, mapBlocks } from "../shared/domain";

const normalized = (blocks: Block[]) => mapBlocks(blocks, (block) => block);

export function removeBlockFromTree(blocks: Block[], id: string): Block[] {
  return normalized(
    blocks
      .filter((block) => block.id !== id)
      .map((block) => ({
        ...block,
        ...(block.children
          ? { children: removeBlockFromTree(block.children, id) }
          : {}),
        ...(block.rooms
          ? {
              rooms: block.rooms.map((room) => ({
                ...room,
                blocks: removeBlockFromTree(room.blocks, id),
              })),
            }
          : {}),
      })),
  );
}

export function insertBlockAfter(
  blocks: Block[],
  afterId: string,
  inserted: Block,
): Block[] {
  return normalized(
    blocks.flatMap((block) => {
      const updated = {
        ...block,
        ...(block.children
          ? { children: insertBlockAfter(block.children, afterId, inserted) }
          : {}),
        ...(block.rooms
          ? {
              rooms: block.rooms.map((room) => ({
                ...room,
                blocks: insertBlockAfter(room.blocks, afterId, inserted),
              })),
            }
          : {}),
      };
      return block.id === afterId ? [updated, inserted] : [updated];
    }),
  );
}

export function duplicateBlockInTree(blocks: Block[], id: string): Block[] {
  const original = allBlocks(blocks).find((block) => block.id === id);
  return original
    ? insertBlockAfter(blocks, id, cloneBlockTree(original))
    : blocks;
}

export function moveBlockInTree(
  blocks: Block[],
  id: string,
  direction: -1 | 1,
): Block[] {
  const index = blocks.findIndex((block) => block.id === id),
    next = index + direction;
  if (index >= 0) {
    if (next < 0 || next >= blocks.length) return blocks;
    const reordered = [...blocks];
    [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
    return reordered;
  }
  return normalized(
    blocks.map((block) => ({
      ...block,
      ...(block.children
        ? { children: moveBlockInTree(block.children, id, direction) }
        : {}),
      ...(block.rooms
        ? {
            rooms: block.rooms.map((room) => ({
              ...room,
              blocks: moveBlockInTree(room.blocks, id, direction),
            })),
          }
        : {}),
    })),
  );
}

/** Move to the end of a group's children or a room's list. Containers cannot be
 * moved into themselves or descendants, and a failed lookup never loses data. */
export function moveBlockToList(
  root: Block,
  id: string,
  listId: string,
): Block {
  const source = allBlocks([root]).find((block) => block.id === id);
  if (!source || source.id === root.id) return root;
  const descendants = allBlocks([source]);
  if (
    descendants.some(
      (block) =>
        block.id === listId || block.rooms?.some((room) => room.id === listId),
    )
  )
    return root;
  const validTarget = allBlocks([root]).some(
    (block) =>
      (block.kind === "group" && block.id === listId) ||
      block.rooms?.some((room) => room.id === listId),
  );
  if (!validTarget) return root;
  return mapBlocks(removeBlockFromTree([root], id), (block) => {
    if (block.kind === "group" && block.id === listId)
      return { ...block, children: [...(block.children ?? []), source] };
    if (block.rooms)
      return {
        ...block,
        rooms: block.rooms.map((room) =>
          room.id === listId
            ? { ...room, blocks: [...room.blocks, source] }
            : room,
        ),
      };
    return block;
  })[0];
}

/** Where a block goes: a list (the day's top level when `listId` is null, a
 * group's children, or a parallel room) and the sibling it is placed before
 * (the end of the list when omitted or unknown). `section` applies only at the
 * top level. When it is omitted, the block takes the section of the block it
 * is placed before, or of the last block when it lands at the end. */
export type BlockDestination = {
  listId: string | null;
  beforeId?: string;
  section?: string;
};

const topLevelSection = (blocks: Block[], destination: BlockDestination) =>
  destination.section ??
  (blocks.find((block) => block.id === destination.beforeId) ?? blocks.at(-1))
    ?.section ??
  "";

const insertInList = (
  items: Block[],
  inserted: Block,
  beforeId?: string,
): Block[] => {
  const index = beforeId ? items.findIndex((item) => item.id === beforeId) : -1;
  return index < 0
    ? [...items, inserted]
    : [...items.slice(0, index), inserted, ...items.slice(index)];
};

/** Inserts a block into any list of the tree. Unknown lists leave it unchanged. */
export function insertBlockInto(
  blocks: Block[],
  inserted: Block,
  destination: BlockDestination,
): Block[] {
  if (destination.listId === null)
    return normalized(
      insertInList(
        blocks,
        { ...inserted, section: topLevelSection(blocks, destination) },
        destination.beforeId,
      ),
    );
  return mapBlocks(blocks, (block) => {
    if (block.kind === "group" && block.id === destination.listId)
      return {
        ...block,
        children: insertInList(
          block.children ?? [],
          inserted,
          destination.beforeId,
        ),
      };
    if (block.rooms?.some((room) => room.id === destination.listId))
      return {
        ...block,
        rooms: block.rooms.map((room) =>
          room.id === destination.listId
            ? {
                ...room,
                blocks: insertInList(
                  room.blocks,
                  inserted,
                  destination.beforeId,
                ),
              }
            : room,
        ),
      };
    return block;
  });
}

const listExists = (blocks: Block[], listId: string | null) =>
  listId === null ||
  allBlocks(blocks).some(
    (block) =>
      (block.kind === "group" && block.id === listId) ||
      block.rooms?.some((room) => room.id === listId),
  );

/** Moves a block anywhere in the tree, including into or out of groups and
 * rooms. A container never moves into itself, and an invalid move keeps the
 * tree unchanged rather than losing the block. */
export function relocateBlock(
  blocks: Block[],
  id: string,
  destination: BlockDestination,
): Block[] {
  if (id === destination.beforeId) {
    // In place: only an explicit, different top-level section changes it, as
    // when the block that follows a section is dropped on its footer.
    const section =
      destination.listId === null ? destination.section : undefined;
    return section !== undefined &&
      blocks.some((block) => block.id === id && block.section !== section)
      ? blocks.map((block) => (block.id === id ? { ...block, section } : block))
      : blocks;
  }
  const source = allBlocks(blocks).find((block) => block.id === id);
  if (!source || !listExists(blocks, destination.listId)) return blocks;
  const inside = allBlocks([source]);
  if (
    destination.listId !== null &&
    inside.some(
      (block) =>
        block.id === destination.listId ||
        block.rooms?.some((room) => room.id === destination.listId),
    )
  )
    return blocks;
  return insertBlockInto(removeBlockFromTree(blocks, id), source, destination);
}

/** Where Monter/Descendre and Alt+↑/↓ move a top-level block one step: past
 * its neighbour in the same section, or, when the neighbour is in another
 * section, across that boundary in place, so no section is skipped. Undefined
 * when there is no neighbour in that direction. */
export function stepDestination(
  blocks: Block[],
  id: string,
  up: boolean,
): BlockDestination | undefined {
  const index = blocks.findIndex((block) => block.id === id);
  const neighbour = index < 0 ? undefined : blocks[up ? index - 1 : index + 1];
  if (!neighbour) return undefined;
  const { section } = blocks[index];
  return neighbour.section === section
    ? {
        listId: null,
        beforeId: blocks[up ? index - 1 : index + 2]?.id,
        section,
      }
    : { listId: null, beforeId: id, section: neighbour.section };
}

/** The day's top level as maximal runs of consecutive blocks sharing a
 * section label, unlabelled runs included (label ""). */
export function sectionRuns(
  blocks: { section: string }[],
): { label: string; start: number; end: number }[] {
  const runs: { label: string; start: number; end: number }[] = [];
  blocks.forEach((block, index) => {
    const last = runs.at(-1);
    if (last?.label === block.section) last.end = index + 1;
    else runs.push({ label: block.section, start: index, end: index + 1 });
  });
  return runs;
}

/** Whether the top-level block at `index` is the first of a section. */
export function startsSection(
  blocks: { section: string }[],
  index: number,
): boolean {
  return (
    !!blocks[index]?.section &&
    (index === 0 || blocks[index - 1].section !== blocks[index].section)
  );
}

/** Inserts a section before a top-level block, like a heading typed in a
 * document: the blocks from there to the end of their run move into it. Where
 * a section already starts, or at the end of the day, the new section starts
 * with `placeholder`. The label is `base`, numbered when the day already uses
 * it, so two new sections never merge. */
export function insertSection(
  blocks: Block[],
  base: string,
  placeholder: Block,
  beforeId?: string,
): { blocks: Block[]; firstId: string } {
  const used = new Set(blocks.map((block) => block.section));
  let label = base;
  for (let n = 2; used.has(label); n++) label = `${base} ${n}`;
  const index = beforeId
    ? blocks.findIndex((block) => block.id === beforeId)
    : -1;
  if (index < 0 || startsSection(blocks, index))
    return {
      blocks: insertBlockInto(blocks, placeholder, {
        listId: null,
        beforeId: index < 0 ? undefined : beforeId,
        section: label,
      }),
      firstId: placeholder.id,
    };
  const run = blocks[index].section;
  let end = index + 1;
  while (end < blocks.length && blocks[end].section === run) end++;
  return {
    blocks: blocks.map((block, i) =>
      i >= index && i < end ? { ...block, section: label } : block,
    ),
    firstId: blocks[index].id,
  };
}

/** Renames the section whose first block is `firstId`. An empty name removes
 * the section and keeps its blocks. */
export function renameSection(
  blocks: Block[],
  firstId: string,
  label: string,
): Block[] {
  const start = blocks.findIndex((block) => block.id === firstId);
  const run = sectionRuns(blocks).find(
    (candidate) => candidate.start === start && candidate.label,
  );
  const section = label.trim();
  if (!run || run.label === section) return blocks;
  return blocks.map((block, i) =>
    i >= run.start && i < run.end ? { ...block, section } : block,
  );
}

/** Replaces the selected top-level blocks with `group`, placed where the
 * first of them was and in its section. */
export function groupBlocks(
  blocks: Block[],
  ids: Set<string>,
  group: Block,
): Block[] {
  const at = blocks.findIndex((block) => ids.has(block.id));
  if (at < 0) return blocks;
  const rest = blocks.filter((block) => !ids.has(block.id));
  return [
    ...rest.slice(0, at),
    { ...group, section: blocks[at].section },
    ...rest.slice(at),
  ];
}
