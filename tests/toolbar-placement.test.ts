import { test } from "node:test";
import assert from "node:assert/strict";
import { toolbarArea, toolbarPlacement } from "../src/toolbar-placement.ts";

test("the editing bar stays inside the panel that clips it", () => {
  // Codex review: the block inspector spans 861–1280 px in a 1280 px window;
  // its description field starts at 881 px.
  const area = toolbarArea([{ top: 72, left: 861, right: 1280 }], {
    width: 1280,
  });
  assert.deepEqual(area, {
    top: 72,
    bottom: Infinity,
    left: 861,
    right: 1280,
    width: 403,
  });
  const placed = toolbarPlacement(
    { top: 450, left: 881 },
    { width: 403, height: 70 },
    area,
  );
  assert.equal(placed.top, -70 - 4, "above the text");
  assert.ok(881 + placed.shift >= 861 + 8, `left ${881 + placed.shift}`);
  assert.ok(881 + placed.shift + 403 <= 1280 - 8);
});

test("near the top of its area the bar goes under the text", () => {
  const area = toolbarArea([], { width: 1280, height: 800 });
  assert.equal(
    toolbarPlacement(
      { top: 20, bottom: 60, left: 400 },
      { width: 500, height: 38 },
      area,
    ).top,
    40 + 4,
  );
  assert.equal(
    toolbarPlacement(
      { top: 300, bottom: 340, left: 400 },
      { width: 500, height: 38 },
      area,
    ).top,
    -38 - 4,
  );
});

test("at the right edge of the window the bar moves left, never past the left edge", () => {
  const area = toolbarArea([], { width: 1000 });
  const placed = toolbarPlacement(
    { top: 300, left: 700 },
    { width: 500, height: 38 },
    area,
  );
  assert.equal(700 + placed.shift + 500, 1000 - 8);
});

test("over a field taller than its area, the bar stays at the top of what is visible", () => {
  // Codex review: a long description scrolled so its top is out of view;
  // below it would be after the whole field, off screen.
  const area = { ...toolbarArea([], { width: 1280 }), bottom: 800 };
  const placed = toolbarPlacement(
    { top: -400, bottom: 1600, left: 400 },
    { width: 500, height: 38 },
    area,
  );
  assert.equal(-400 + placed.top, 4, "pinned 4 px under the top of the area");
  // A short field near the top still gets the bar under it.
  const short = toolbarPlacement(
    { top: 20, bottom: 80, left: 400 },
    { width: 500, height: 38 },
    area,
  );
  assert.equal(short.top, 60 + 4);
  // And with room above, above it.
  const roomy = toolbarPlacement(
    { top: 300, bottom: 360, left: 400 },
    { width: 500, height: 38 },
    area,
  );
  assert.equal(roomy.top, -38 - 4);
});
