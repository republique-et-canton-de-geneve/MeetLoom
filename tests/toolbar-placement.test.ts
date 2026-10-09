import { test } from "node:test";
import assert from "node:assert/strict";
import { toolbarArea, toolbarPlacement } from "../src/toolbar-placement.ts";

test("the editing bar stays inside the panel that clips it", () => {
  // Codex review: the block inspector spans 861–1280 px in a 1280 px window;
  // its description field starts at 881 px.
  const area = toolbarArea([{ top: 72, left: 861, right: 1280 }], {
    width: 1280,
  });
  assert.deepEqual(area, { top: 72, left: 861, right: 1280, width: 403 });
  const placed = toolbarPlacement(
    { top: 450, left: 881 },
    { width: 403, height: 70 },
    area,
  );
  assert.equal(placed.below, false);
  assert.ok(881 + placed.shift >= 861 + 8, `left ${881 + placed.shift}`);
  assert.ok(881 + placed.shift + 403 <= 1280 - 8);
});

test("near the top of its area the bar goes under the text", () => {
  const area = toolbarArea([], { width: 1280 });
  assert.equal(
    toolbarPlacement({ top: 20, left: 400 }, { width: 500, height: 38 }, area)
      .below,
    true,
  );
  assert.equal(
    toolbarPlacement({ top: 300, left: 400 }, { width: 500, height: 38 }, area)
      .below,
    false,
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
