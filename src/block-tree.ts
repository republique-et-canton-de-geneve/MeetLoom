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
 * (the end of the list when omitted or unknown). */
export type BlockDestination = { listId: string | null; beforeId?: string };

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
    return normalized(insertInList(blocks, inserted, destination.beforeId));
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
  if (id === destination.beforeId) return blocks;
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
