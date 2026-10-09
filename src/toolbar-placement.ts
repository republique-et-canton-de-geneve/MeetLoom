/** Where a floating editing bar can show: the window, narrowed by every
 * ancestor that clips what overflows it (a side panel, a scrolling list).
 * `width` is the most the bar may take there, with an 8 px margin on each
 * side; a narrower bar wraps onto a second row. */
export function toolbarArea(
  clips: { top: number; bottom?: number; left: number; right: number }[],
  window: { width: number; height?: number },
): { top: number; bottom: number; left: number; right: number; width: number } {
  let top = 0,
    bottom = window.height ?? Infinity,
    left = 0,
    right = window.width;
  for (const clip of clips) {
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom ?? Infinity);
    left = Math.max(left, clip.left);
    right = Math.min(right, clip.right);
  }
  return { top, bottom, left, right, width: Math.max(0, right - left - 16) };
}

/** Where the bar goes for text at `box`, as offsets from the box's top and
 * left: above the text by default; below it when there is no room above
 * and the text ends in view; otherwise (a field taller than what is
 * visible) at the top of the visible area, over the text. Moved sideways to
 * stay inside the area. It floats, so the text under the pointer never
 * moves. */
export function toolbarPlacement(
  box: { top: number; bottom?: number; left: number },
  bar: { width: number; height: number },
  area: { top: number; bottom?: number; left: number; right: number },
): { top: number; shift: number } {
  const height = (box.bottom ?? box.top) - box.top,
    above = box.top - bar.height - 4 >= area.top,
    below = box.top + height + 4 + bar.height <= (area.bottom ?? Infinity);
  return {
    top: above ? -bar.height - 4 : below ? height + 4 : area.top + 4 - box.top,
    shift: Math.max(
      area.left + 8 - box.left,
      Math.min(0, area.right - 8 - (box.left + bar.width)),
    ),
  };
}
