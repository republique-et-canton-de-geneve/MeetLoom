import { test } from "node:test";
import assert from "node:assert/strict";
import {
  arriving,
  followedDay,
  inView,
  needsFollow,
} from "../src/useFollowCurrent.ts";

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

test("an opened session shows the day being run, not its first day", () => {
  const days = [{ id: "day-1" }, { id: "day-2" }];
  const run = (status: string, dayId: string | null) => ({ status, dayId });
  assert.equal(followedDay(run("running", "day-2"), days), "day-2");
  assert.equal(followedDay(run("paused", "day-2"), days), "day-2");
  assert.equal(followedDay(run("idle", "day-2"), days), null);
  assert.equal(followedDay(run("finished", "day-2"), days), null);
  assert.equal(followedDay(run("running", "deleted"), days), null);
});

test("a block hidden under the sticky timer counts as scrolled away from", () => {
  // Codex review: someone who scrolled the current row under the opaque
  // timer to read further was still taken back at the next block.
  const seen = (top: number, height = 80) =>
    inView({ top, bottom: top + height }, 200, 900);
  assert.equal(seen(100), false, "under the sticky timer");
  assert.equal(seen(-500), false, "scrolled past");
  assert.equal(seen(950), false, "below the window");
  assert.equal(seen(150), true, "partly below the timer");
  assert.equal(seen(400), true);
});

test("a follow scroll still under way keeps following; a page scrolled elsewhere does not", () => {
  const scroll = { from: 900, to: 1066, at: 10_000 };
  assert.equal(arriving(scroll, 980, 10_400), true, "on its way");
  assert.equal(arriving(scroll, 1066, 10_400), true, "arrived");
  assert.equal(arriving(scroll, 0, 10_400), false, "scrolled back to the top");
  assert.equal(arriving(scroll, 1500, 10_400), false, "scrolled further down");
  assert.equal(arriving(scroll, 980, 14_000), false, "long ago");
  assert.equal(arriving(null, 980, 10_400), false);
});
