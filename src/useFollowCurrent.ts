import { useEffect, useRef } from "react";

/** Whether the page should scroll to the block being run: it is hidden
 * (under the sticky timer or off screen) or too low to show what follows.
 * `top` and `bottom` are its edges in the window, `offset` the height of
 * whatever sticks to the top of the window. */
export function needsFollow(
  { top, bottom }: { top: number; bottom: number },
  offset: number,
  height: number,
): boolean {
  return (
    top < offset || bottom > height || top > offset + (height - offset) * 0.4
  );
}

/** The day being run, which an opened agenda shows rather than its first
 * day so it can follow the run; null when nothing runs. */
export function followedDay(
  run: { status: string; dayId: string | null },
  days: { id: string }[],
): string | null {
  return (run.status === "running" || run.status === "paused") &&
    days.some((day) => day.id === run.dayId)
    ? run.dayId
    : null;
}

/** Whether a block at `top`–`bottom` in the window can be seen: some of it
 * lies below whatever sticks to the top (`offset`) and above the bottom. */
export function inView(
  { top, bottom }: { top: number; bottom: number },
  offset: number,
  height: number,
): boolean {
  return bottom > offset && top < height;
}

/** Whether a follow scroll may still be taking the person to its block:
 * the page is still between where that scroll started and its target, and
 * not for long. A page outside that span was scrolled elsewhere. */
export function arriving(
  scroll: { from: number; to: number; at: number } | null,
  y: number,
  now: number,
): boolean {
  return (
    !!scroll &&
    now - scroll.at < 3000 &&
    y >= Math.min(scroll.from, scroll.to) - 2 &&
    y <= Math.max(scroll.from, scroll.to) + 2
  );
}

const typing = () =>
  !!document.activeElement?.matches(
    "input, textarea, select, [contenteditable='true']",
  );

/** Keeps the block being run in view as the run moves on: on arrival, and
 * each time it moves to another block, the page scrolls that block to the
 * top (just under `offset()`, a sticky timer) with what follows below it.
 * It only follows someone who was following: the previous block was in view
 * (not hidden under the sticky timer) and nobody is typing. Whoever
 * scrolled away to read or edit elsewhere stays where they are. `key`
 * changes with the current block and is null when nothing runs; the block
 * is the last element matching `selector` (the innermost one when groups
 * are open). */
export function useFollowCurrent(
  key: string | null,
  selector: string,
  offset: () => number = () => 0,
) {
  const followed = useRef<{
    key: string | null;
    element?: HTMLElement;
    scroll: { from: number; to: number; at: number } | null;
  }>({ key: null, scroll: null });
  useEffect(() => {
    const element = key
      ? [...document.querySelectorAll<HTMLElement>(selector)].at(-1)
      : undefined;
    const previous = followed.current;
    if (key === previous.key || (key && !element)) {
      // Same block (its row may have been drawn again), or not shown yet.
      if (element) previous.element = element;
      return;
    }
    const space = offset(),
      now = Date.now();
    const following =
      !previous.element?.isConnected ||
      arriving(previous.scroll, scrollY, now) ||
      inView(previous.element.getBoundingClientRect(), space, innerHeight);
    let scroll: (typeof previous)["scroll"] = null;
    if (element && following && !typing()) {
      const box = element.getBoundingClientRect();
      if (needsFollow(box, space, innerHeight)) {
        scroll = { from: scrollY, to: scrollY + box.top - space - 12, at: now };
        window.scrollTo({
          top: scroll.to,
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      }
    }
    followed.current = { key, element, scroll };
  });
}
