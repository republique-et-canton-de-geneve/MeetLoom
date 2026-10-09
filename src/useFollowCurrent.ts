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

const typing = () =>
  !!document.activeElement?.matches(
    "input, textarea, select, [contenteditable='true']",
  );

/** Keeps the block being run in view as the run moves on: on arrival, and
 * each time it moves to another block, the page scrolls that block to the
 * top (just under `offset()`, a sticky timer) with what follows below it.
 * It only follows someone who was following: the previous block was on
 * screen and nobody is typing. Whoever scrolled away to read or edit
 * elsewhere stays where they are. `key` changes with the current block and
 * is null when nothing runs; the block is the last element matching
 * `selector` (the innermost one when groups are open). */
export function useFollowCurrent(
  key: string | null,
  selector: string,
  offset: () => number = () => 0,
) {
  const followed = useRef<{ key: string | null; visible: boolean }>({
    key: null,
    visible: true,
  });
  const observed = useRef<{
    element: Element;
    observer: IntersectionObserver;
  } | null>(null);
  useEffect(() => {
    const element = key
      ? [...document.querySelectorAll<HTMLElement>(selector)].at(-1)
      : undefined;
    const state = followed.current;
    if (key !== state.key && (!key || element)) {
      if (element && state.visible && !typing()) {
        const space = offset(),
          box = element.getBoundingClientRect();
        if (needsFollow(box, space, window.innerHeight))
          window.scrollTo({
            top: window.scrollY + box.top - space - 12,
            behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
              ? "auto"
              : "smooth",
          });
      }
      // Once arrived, it follows from there.
      followed.current = { key, visible: true };
    }
    // Watch whether the current block stays on screen (or was scrolled
    // away from) until the next move.
    if (observed.current?.element === element) return;
    observed.current?.observer.disconnect();
    observed.current = null;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      followed.current.visible = entry.isIntersecting;
    });
    observer.observe(element);
    observed.current = { element, observer };
  });
  useEffect(() => () => observed.current?.observer.disconnect(), []);
}
