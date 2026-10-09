/** Layout of the always-on-top progress window. Its text follows the window:
 * the content is arranged as a one-line strip, a two-row box or a stacked
 * column, whichever shows the most information at a readable size, and
 * then makes it as large as the window allows. Sizes are multiples of one
 * unit (the title's font size); the .floating-window rules in styles.css
 * use the same proportions. */

type FloatingShape = "strip" | "box" | "column";
type FloatingItem =
  "title" | "badge" | "end" | "position" | "left" | "kicker" | "label";

export interface FloatingFit {
  shape: FloatingShape;
  /** Items left out to keep the rest readable. */
  hidden: FloatingItem[];
  /** Font sizes in pixels. */
  title: number;
  clock: number;
  detail: number;
  /** Facilitator button size in pixels. */
  button: number;
  /** Lines the title may take before its ellipsis. */
  titleLines: 1 | 2;
  padX: number;
  padY: number;
}

/** Proportions per shape, in units: the clock's font size, the details'
 * (status, position, schedule) and the facilitator buttons'. */
const SHAPES: Record<
  FloatingShape,
  { clock: number; detail: number; button: number }
> = {
  strip: { clock: 1.75, detail: 0.72, button: 1.75 },
  box: { clock: 2.4, detail: 0.6, button: 1.9 },
  column: { clock: 3, detail: 0.6, button: 1.9 },
};

/** How much each item tells, and so which ones go first. */
const WEIGHT: Record<FloatingItem, number> = {
  title: 6,
  badge: 5,
  end: 4,
  position: 3,
  left: 2,
  kicker: 1,
  label: 1,
};
/** The order items are given up in, per shape: the strip first gives up
 * the second line under the title, the others the small labels. */
const DROPS: Record<FloatingShape, FloatingItem[][]> = {
  strip: [
    ["label"],
    ["kicker", "position"],
    ["left"],
    ["end"],
    ["badge"],
    ["title"],
  ],
  box: [[], ["kicker", "label"], ["left"], ["position"], ["end"], ["badge"]],
  column: [[], ["kicker", "label"], ["left"], ["position"], ["end"], ["badge"]],
};

// Character widths in ems (French labels, the longer ones) and line heights.
const CHAR = 0.56,
  TITLE_CHAR = 0.58,
  DIGIT = 0.6,
  LINE = 1.3,
  TITLE_LINE = 1.2,
  GAP = 0.3,
  GROUP = 0.8,
  TRACK = 0.35 + 0.22;
/** Characters of each detail ("EN CE MOMENT", "1 / 7 · Jour 1", "Dans le
 * temps prévu", "Fin prévue 15:47", "· reste 1 h 38 min", "restantes"). */
const CHARS = { kicker: 12 * 1.3, position: 16, badge: 19, end: 16, left: 18 };
/** The dock button's size, relative to the facilitator buttons. */
const DOCK = 0.6;
/** Characters of the title given room for (longer ones end with an
 * ellipsis), on one line in a strip, on one or two lines in a box. */
const TITLE_ROOM = { strip: 20, box: 24 };
/** Smallest readable text, in pixels. */
const MIN_DETAIL = 12,
  MIN_TITLE = 14;

interface Content {
  controls: boolean;
  /** Characters of the current block's title. */
  titleChars: number;
  /** Characters of the clock ("05:00", "+1:05:00", "✓" once finished). */
  clockChars: number;
  /** False when the schedule line and the clock's label are not shown (a
   * finished run): no room is kept for them. */
  schedule?: boolean;
}

/** Width and height, in units, of one arrangement. */
function measure(
  shape: FloatingShape,
  show: (item: FloatingItem) => boolean,
  { controls, clockChars, titleChars }: Content,
  { wrapSchedule, titleLines }: { wrapSchedule: boolean; titleLines: 1 | 2 },
): [number, number] {
  const { clock, detail, button } = SHAPES[shape];
  const line = detail * LINE,
    badge = detail * 1.6,
    clockWidth = Math.max(clockChars, 1) * DIGIT * clock,
    title = Math.max(titleChars, 6),
    titleWidth = !show("title")
      ? 0
      : shape === "strip"
        ? Math.min(title, TITLE_ROOM.strip) * TITLE_CHAR
        : titleLines === 1
          ? Math.min(title, TITLE_ROOM.box) * TITLE_CHAR
          : // Words do not break evenly: a little more than half.
            (Math.min(title, 2 * TITLE_ROOM.box) / 2 + 2) * TITLE_CHAR;
  const schedule = [
    show("badge") ? (CHARS.badge * CHAR + 2.4) * detail : 0,
    show("end") ? CHARS.end * CHAR * detail : 0,
    show("left") ? CHARS.left * CHAR * detail : 0,
  ].filter(Boolean);
  const scheduleWidth =
    schedule.reduce((sum, width) => sum + width, 0) +
    Math.max(0, schedule.length - 1) * 0.4;
  // The facilitator's three buttons (with their separator) and the dock
  // button, smaller, after them.
  const actions = {
    width: (controls ? 3 * button + 0.16 + 0.5 + 0.1 : 0) + DOCK * button,
    height: controls ? button : DOCK * button,
  };
  if (shape === "strip") {
    const sub = show("kicker") || show("position");
    const height =
      Math.max(
        show("title") ? TITLE_LINE + (sub ? GAP + line : 0) : 0,
        clock,
        schedule.length ? badge : 0,
        actions.height,
      ) + TRACK;
    const width =
      (show("title") ? titleWidth + GROUP : 0) +
      clockWidth +
      (schedule.length ? GROUP + scheduleWidth : 0) +
      GROUP +
      actions.width;
    return [width, height];
  }
  if (shape === "box") {
    const left =
      (show("kicker") ? line + GAP : 0) +
      (show("title") ? titleLines * TITLE_LINE : 0) +
      (show("position") ? GAP + line : 0);
    const right = clock + (show("label") ? 0.15 + line : 0);
    const rows = wrapSchedule && schedule.length > 1 ? 2 : 1;
    const height =
      Math.max(left, right) +
      TRACK +
      (schedule.length ? 0.4 + rows * badge + (rows - 1) * GAP : 0);
    const width =
      Math.max(
        (show("title") ? titleWidth + GROUP : 0) + clockWidth,
        scheduleWidth / rows,
      ) +
      GROUP +
      actions.width;
    return [width, height];
  }
  // A column: everything stacked and centred, the title on up to two lines.
  const height =
    (show("kicker") ? line + GAP : 0) +
    (show("title") ? titleLines * TITLE_LINE + GAP : 0) +
    (show("position") ? line + GAP : 0) +
    clock +
    (show("label") ? 0.15 + line : 0) +
    TRACK +
    (schedule.length
      ? 0.4 + (show("badge") ? badge : 0) + (schedule.length - 1) * (GAP + line)
      : 0) +
    0.5 +
    actions.height;
  const width = Math.max(
    clockWidth,
    show("title") ? 10 * TITLE_CHAR : 0,
    ...[
      show("badge") ? (CHARS.badge * CHAR + 2.4) * detail : 0,
      show("end") ? CHARS.end * CHAR * detail : 0,
      show("left") ? CHARS.left * CHAR * detail : 0,
      show("position") ? CHARS.position * CHAR * detail : 0,
    ],
    actions.width,
  );
  return [width, height];
}

const round = (value: number) => Math.floor(value * 10) / 10;

/** The arrangement of a window `width` x `height` pixels (its inside). */
export function floatingFit(
  width: number,
  height: number,
  content: Content,
): FloatingFit {
  const padX = round(Math.min(32, Math.max(6, width * 0.02))),
    padY = round(Math.min(24, Math.max(4, height * 0.06)));
  const inner = [Math.max(1, width - 2 * padX), Math.max(1, height - 2 * padY)];
  let best: (FloatingFit & { score: number; unit: number }) | null = null;
  for (const shape of ["box", "strip", "column"] as const) {
    const all = Object.keys(WEIGHT) as FloatingItem[];
    // What is not rendered at all takes no room and counts for nothing.
    const hidden: FloatingItem[] =
      content.schedule === false ? ["badge", "end", "left", "label"] : [];
    for (const drop of [...DROPS[shape], all]) {
      hidden.push(...drop.filter((item) => !hidden.includes(item)));
      const show = (item: FloatingItem) => !hidden.includes(item);
      // A box may wrap its title and its schedule onto a second line.
      const variants =
        shape === "box"
          ? ([1, 2] as const).flatMap((titleLines) =>
              [false, true].map((wrapSchedule) => ({
                titleLines,
                wrapSchedule,
              })),
            )
          : [
              {
                titleLines: shape === "column" ? (2 as const) : (1 as const),
                wrapSchedule: false,
              },
            ];
      const [unit, variant] = variants
        .map((option) => {
          const [w, h] = measure(shape, show, content, option);
          return [Math.min(inner[0] / w, inner[1] / h), option] as const;
        })
        .reduce((a, b) => (b[0] > a[0] ? b : a));
      const { clock, detail, button } = SHAPES[shape];
      const details = (["badge", "end", "left", "position"] as const).some(
        show,
      );
      const readable =
        (!show("title") || unit >= MIN_TITLE) &&
        (!details || unit * detail >= MIN_DETAIL);
      if (!readable && hidden.length < all.length) continue;
      const score = (Object.keys(WEIGHT) as FloatingItem[])
        .filter(show)
        .reduce((sum, item) => sum + WEIGHT[item], 0);
      // Same information: the larger countdown wins (shapes scale it
      // differently, so their units do not compare), then the larger text.
      const countdown = unit * clock,
        bestCountdown = best ? best.unit * SHAPES[best.shape].clock : 0;
      if (
        !best ||
        score > best.score ||
        (score === best.score &&
          (countdown > bestCountdown ||
            (countdown === bestCountdown && unit > best.unit)))
      )
        best = {
          shape,
          hidden: [...hidden],
          unit,
          score,
          title: round(unit),
          clock: round(unit * clock),
          detail: round(unit * detail),
          button: round(unit * button),
          titleLines: variant.titleLines,
          padX,
          padY,
        };
      break;
    }
  }
  const { score: _score, unit: _unit, ...fit } = best!;
  return fit;
}

export type FloatingTarget = "top" | "bottom" | "left" | "right" | "default";
/** Inside size of the window as first opened. */
export const FLOATING_SIZE = { width: 600, height: 200 };
/** Inside height of a strip along the top or bottom, outside width of a
 * column along a side. */
const STRIP_HEIGHT = 72,
  COLUMN_WIDTH = 300;

/** Outer bounds for the window along an edge of the screen (its available
 * area). A popup can be moved there; Chrome and Edge never let a page move
 * the always-on-top window and keep it under 80 % of the screen, so it only
 * takes the shape and the person drags it to the edge. */
export function floatingBounds(
  target: FloatingTarget,
  screen: { left: number; top: number; width: number; height: number },
  frame: { width: number; height: number },
  movable: boolean,
): { width: number; height: number; left?: number; top?: number } {
  const share = movable ? 1 : 0.8;
  if (target === "default")
    return {
      width: FLOATING_SIZE.width + frame.width,
      height: FLOATING_SIZE.height + frame.height,
    };
  if (target === "top" || target === "bottom") {
    const width = Math.round(screen.width * share),
      height = STRIP_HEIGHT + frame.height;
    return movable
      ? {
          left: screen.left,
          top:
            target === "top" ? screen.top : screen.top + screen.height - height,
          width,
          height,
        }
      : { width, height };
  }
  const width = COLUMN_WIDTH + frame.width,
    height = Math.round(screen.height * share);
  return movable
    ? {
        left:
          target === "left" ? screen.left : screen.left + screen.width - width,
        top: screen.top,
        width,
        height,
      }
    : { width, height };
}
