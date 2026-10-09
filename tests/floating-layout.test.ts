import { test } from "node:test";
import assert from "node:assert/strict";
import { floatingBounds, floatingFit } from "../src/floating-layout.ts";

// "Bienvenue et intentions", the block of the feedback screenshots.
const facilitator = { controls: true, clockChars: 5, titleChars: 23 };
const visitor = { controls: false, clockChars: 5, titleChars: 23 };
const shown = (fit: ReturnType<typeof floatingFit>, item: string) =>
  !fit.hidden.includes(item as never);

test("a thin strip across the screen puts everything on one large line", () => {
  // The strips of the feedback screenshots: 1458 px wide, 56 and 110 px high.
  const thin = floatingFit(1458, 56, facilitator);
  assert.equal(thin.shape, "strip");
  assert.ok(thin.title >= 20, `title ${thin.title}px`);
  assert.ok(thin.clock >= 34, `clock ${thin.clock}px`);
  assert.ok(thin.detail >= 12, `detail ${thin.detail}px`);
  for (const item of ["title", "badge", "end"])
    assert.ok(shown(thin, item), item);
  const taller = floatingFit(1458, 110, facilitator);
  assert.equal(taller.shape, "strip");
  assert.ok(taller.clock >= 45, `clock ${taller.clock}px`);
  assert.ok(shown(taller, "position"), "room for the block's position");
});

test("a large window shows everything, and larger as it grows", () => {
  const original = floatingFit(600, 200, facilitator);
  const large = floatingFit(1536, 470, facilitator);
  assert.equal(large.hidden.length, 0);
  assert.equal(large.shape, "box");
  assert.ok(large.clock >= 2.2 * original.clock, `${large.clock}px`);
  assert.ok(large.title >= 2.2 * original.title, `${large.title}px`);
  // The window as opened stays at least as readable as before (22 px
  // title, 45 px clock, 12 px details at 560 x 188).
  assert.equal(original.hidden.length, 0);
  assert.ok(original.title >= 22 && original.clock >= 45);
  assert.ok(original.detail >= 12);
});

test("a narrow column along a side stacks the content", () => {
  const column = floatingFit(300, 860, facilitator);
  assert.equal(column.shape, "column");
  assert.equal(column.hidden.length, 0);
  assert.ok(column.clock >= 80, `clock ${column.clock}px`);
});

test("a larger window never shows less, and the same content never smaller", () => {
  for (const [from, to] of [
    [
      [400, 60],
      [800, 60],
    ],
    [
      [800, 60],
      [800, 120],
    ],
    [
      [560, 188],
      [900, 300],
    ],
    [
      [280, 500],
      [320, 900],
    ],
  ] as const) {
    const before = floatingFit(from[0], from[1], visitor),
      after = floatingFit(to[0], to[1], visitor);
    assert.ok(
      after.hidden.every((item) => before.hidden.includes(item)),
      `${from} → ${to}: ${before.hidden} → ${after.hidden}`,
    );
    if (after.hidden.length === before.hidden.length)
      assert.ok(
        after.clock >= before.clock && after.title >= before.title,
        `${from} → ${to}: clock ${before.clock} → ${after.clock}`,
      );
  }
});

test("what is shown stays readable; the clock always stays", () => {
  for (const width of [200, 320, 560, 900, 1400])
    for (const height of [40, 70, 120, 200, 400, 800]) {
      const fit = floatingFit(width, height, facilitator);
      assert.ok(fit.clock > 0);
      if (shown(fit, "title"))
        assert.ok(fit.title >= 14, `${width}x${height} title ${fit.title}`);
      if (["badge", "end", "left", "position"].some((i) => shown(fit, i)))
        assert.ok(fit.detail >= 12, `${width}x${height} detail ${fit.detail}`);
    }
});

test("edges: a popup moves there; the always-on-top window only takes the shape", () => {
  const screen = { left: 0, top: 0, width: 1920, height: 1040 },
    frame = { width: 0, height: 32 };
  assert.deepEqual(floatingBounds("top", screen, frame, true), {
    left: 0,
    top: 0,
    width: 1920,
    height: 104,
  });
  assert.deepEqual(floatingBounds("bottom", screen, frame, true), {
    left: 0,
    top: 936,
    width: 1920,
    height: 104,
  });
  assert.deepEqual(floatingBounds("right", screen, frame, true), {
    left: 1620,
    top: 0,
    width: 300,
    height: 1040,
  });
  // Chrome and Edge keep the always-on-top window under 80 % of the screen
  // and never let a page move it.
  assert.deepEqual(floatingBounds("top", screen, frame, false), {
    width: 1536,
    height: 104,
  });
  assert.deepEqual(floatingBounds("left", screen, frame, false), {
    width: 300,
    height: 832,
  });
  assert.deepEqual(floatingBounds("default", screen, frame, false), {
    width: 600,
    height: 232,
  });
});

test("a finished run keeps its title: no room is kept for the schedule it no longer shows", () => {
  // Codex review: a 300 x 100 facilitator window once the run is over.
  const finished = floatingFit(300, 100, {
    controls: true,
    clockChars: 1,
    titleChars: 23,
    schedule: false,
  });
  assert.ok(shown(finished, "title"), `hidden: ${finished.hidden}`);
  assert.ok(finished.title >= 14);
});

test("growing the window never shrinks the countdown while the same items show", () => {
  // Codex review: 355 x 140 → 360 x 140 switched from a column to a box and
  // the countdown went from 42.6 to 34.2 px.
  for (const controls of [true, false])
    for (let height = 40; height <= 880; height += 40)
      for (let width = 200; width <= 1600; width += 10) {
        const content = { controls, clockChars: 5, titleChars: 23 };
        const from = floatingFit(width, height, content);
        for (const [w, h] of [
          [width + 5, height],
          [width, height + 20],
        ]) {
          const to = floatingFit(w, h, content);
          if (to.hidden.join() === from.hidden.join())
            assert.ok(
              to.clock >= from.clock,
              `${width}x${height} → ${w}x${h}: ${from.shape} ${from.clock} → ${to.shape} ${to.clock}`,
            );
        }
      }
});
