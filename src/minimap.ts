import type { Block, Day, RunState } from "../shared/model";
import {
  blockDuration,
  runnableBlocks,
  scheduleTreeDay,
} from "../shared/domain";

/** One block of the sidebar minimap. Groups keep their children and parallel
 * blocks their rooms, so the map shows what the agenda shows inside them. */
export interface MinimapItem {
  block: Block;
  startMinute: number;
  /** blockDuration, the item's share of the map's height. */
  minutes: number;
  status: "idle" | "upcoming" | "current" | "done";
  /** Group only. */
  children: MinimapItem[];
  /** Parallel only. */
  rooms: { id: string; title: string; minutes: number; items: MinimapItem[] }[];
  /** Containers to open so the title is rendered, outermost first; roomId is
   * the tab to select. */
  ancestors: { id: string; roomId?: string }[];
}

const listMinutes = (blocks: Block[]) =>
  blocks.reduce((sum, block) => sum + blockDuration(block), 0);

/** The day as a tree, with each timer step's status while a run is running
 * or paused on this day. A finished run leaves the map plain: the
 * actual-duration chips keep the record. */
export function minimapItems(
  day: Pick<Day, "id" | "startTime" | "blocks">,
  run: RunState,
): MinimapItem[] {
  const starts = new Map(
    scheduleTreeDay(day).map((row) => [row.block.id, row.startMinute]),
  );
  const live =
    (run.status === "running" || run.status === "paused") &&
    run.dayId === day.id;
  // Current is checked first: an automatic-extension rewind can leave an
  // actual duration on the step that runs again.
  const step = (id: string): MinimapItem["status"] =>
    !live
      ? "idle"
      : run.blockId === id
        ? "current"
        : Object.hasOwn(run.actualDurations ?? {}, id)
          ? "done"
          : "upcoming";
  const statusOf = (block: Block): MinimapItem["status"] => {
    if (block.kind === "note") return "idle";
    if (!block.children) return step(block.id);
    const steps = runnableBlocks(block.children).map((child) => step(child.id));
    return steps.includes("current")
      ? "current"
      : steps.length && steps.every((status) => status === "done")
        ? "done"
        : live
          ? "upcoming"
          : "idle";
  };
  // A parallel block is one timer step: everything in its rooms follows it
  // and is never current on its own.
  const walk = (
    blocks: Block[],
    ancestors: MinimapItem["ancestors"],
    inherited?: MinimapItem["status"],
  ): MinimapItem[] =>
    blocks.map((block) => {
      const status =
        inherited === undefined
          ? statusOf(block)
          : block.kind === "note"
            ? "idle"
            : inherited;
      return {
        block,
        startMinute: starts.get(block.id) ?? 0,
        minutes: blockDuration(block),
        status,
        children: block.children
          ? walk(block.children, [...ancestors, { id: block.id }], inherited)
          : [],
        rooms:
          block.kind === "parallel"
            ? (block.rooms ?? []).map((room) => ({
                id: room.id,
                title: room.title,
                minutes: listMinutes(room.blocks),
                items: walk(
                  room.blocks,
                  [...ancestors, { id: block.id, roomId: room.id }],
                  status === "current" ? "upcoming" : status,
                ),
              }))
            : [],
        ancestors,
      };
    });
  return walk(day.blocks, []);
}

/** Activity minutes per category, through groups and the longest room of a
 * parallel block (the first on a tie), so they add up to totalDuration. */
export function categoryMinutes(blocks: Block[]): Map<string, number> {
  const minutes = new Map<string, number>();
  const add = (list: Block[]) => {
    for (const block of list) {
      if (block.kind === "note") continue;
      if (block.children) add(block.children);
      else if (block.kind === "parallel")
        add(
          (block.rooms ?? []).reduce<Block[]>(
            (longest, room) =>
              listMinutes(room.blocks) > listMinutes(longest)
                ? room.blocks
                : longest,
            [],
          ),
        );
      else
        minutes.set(
          block.category,
          (minutes.get(block.category) ?? 0) + blockDuration(block),
        );
    }
  };
  add(blocks);
  return minutes;
}

/** The editor's collapsed blocks and room tabs once every container holding
 * a block is open, so its title is rendered when the jump scrolls to it. */
export function openAncestors(
  view: { collapsed: Set<string>; roomTabs: Record<string, string> },
  ancestors: MinimapItem["ancestors"],
) {
  const collapsed = new Set(view.collapsed),
    roomTabs = { ...view.roomTabs };
  for (const { id, roomId } of ancestors) {
    collapsed.delete(id);
    if (roomId) roomTabs[id] = roomId;
  }
  return { collapsed, roomTabs };
}

/** The minimap's scrollTop for an item (offsets from the top of its
 * content): unchanged while it is in view, otherwise centered so the steps
 * around it show too, or its start when it is taller than the view. */
export function revealScrollTop(
  view: { scrollTop: number; clientHeight: number },
  item: { top: number; bottom: number },
) {
  const height = item.bottom - item.top;
  if (
    item.top >= view.scrollTop &&
    item.bottom <= view.scrollTop + view.clientHeight
  )
    return view.scrollTop;
  return Math.max(
    0,
    height >= view.clientHeight
      ? item.top
      : item.top - (view.clientHeight - height) / 2,
  );
}
