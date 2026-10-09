import { test } from "node:test";
import assert from "node:assert/strict";
import { needsFollow } from "../src/useFollowCurrent.ts";

// A 900 px window whose top 200 px are a sticky timer.
const follow = (top: number, height = 80) =>
  needsFollow({ top, bottom: top + height }, 200, 900);

test("the block being run is brought up when it is hidden or too low to show what follows", () => {
  assert.equal(follow(150), true, "under the sticky timer");
  assert.equal(follow(-300), true, "scrolled past");
  assert.equal(follow(1200), true, "below the window");
  assert.equal(follow(860), true, "cut by the bottom of the window");
  assert.equal(follow(650), true, "visible, but nothing after it is");
});

test("a block already near the top stays put, so short agendas do not jump", () => {
  assert.equal(follow(200), false);
  assert.equal(follow(420), false);
});
