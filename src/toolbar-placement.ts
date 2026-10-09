/** Where a floating editing bar can show: the window, narrowed by every
 * ancestor that clips what overflows it (a side panel, a scrolling list).
 * `width` is the most the bar may take there, with an 8 px margin on each
 * side; a narrower bar wraps onto a second row. */
export function toolbarArea(
  clips: { top: number; left: number; right: number }[],
  window: { width: number },
): { top: number; left: number; right: number; width: number } {
  let top = 0,
    left = 0,
    right = window.width;
  for (const clip of clips) {
    top = Math.max(top, clip.top);
    left = Math.max(left, clip.left);
    right = Math.min(right, clip.right);
  }
  return { top, left, right, width: Math.max(0, right - left - 16) };
}

/** Where the bar goes for text at `box`: above it by default, below it when
 * it would leave the top of its area, and moved sideways to stay inside the
 * area. It floats, so the text under the pointer never moves. */
export function toolbarPlacement(
  box: { top: number; left: number },
  bar: { width: number; height: number },
  area: { top: number; left: number; right: number },
): { below: boolean; shift: number } {
  return {
    below: box.top - bar.height - 4 < area.top,
    shift: Math.max(
      area.left + 8 - box.left,
      Math.min(0, area.right - 8 - (box.left + bar.width)),
    ),
  };
}
