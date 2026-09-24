import test from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  newBlock,
  totalDuration,
  transitionRun,
} from "../shared/domain.js";
import { durationLabel } from "../src/ui.tsx";

const at = (seconds: number) => 1_000_000 + seconds * 1000;

test("using actual durations keeps whole minutes, rounded down", () => {
  let s = createSession("owner", "Minutes", "fr", false);
  s.days[0].blocks = [
    newBlock("fr", { title: "A", duration: 2 }),
    newBlock("fr", { title: "B", duration: 2 }),
    newBlock("fr", { title: "C", duration: 2 }),
  ];
  s = transitionRun(s, "start", {}, at(0));
  s = transitionRun(s, "next", {}, at(151.453));
  s = transitionRun(s, "next", {}, at(151.453 + 30));
  s = transitionRun(s, "next", {}, at(151.453 + 30 + 119.9));
  const applied = transitionRun(s, "apply-actual", {}, at(400));
  assert.deepEqual(
    applied.days[0].blocks.map((block) => block.duration),
    [2, 0, 1],
  );
  assert.equal(totalDuration(applied), 3);
});

test("duration labels never show decimals", () => {
  assert.equal(durationLabel(2.5242166666666668), "2 min");
  assert.equal(durationLabel(0.91), "0 min");
  assert.equal(durationLabel(59.99), "59 min");
  assert.equal(durationLabel(90.5), "1 h 30 min");
  assert.equal(durationLabel(120), "2 h");
});

test("locking a block at its displayed time never reports a false overlap", async () => {
  const { scheduleDay } = await import("../shared/domain.js");
  const s = createSession("owner", "Locks", "fr", false);
  s.days[0].startTime = "18:00";
  s.days[0].blocks = [
    // A legacy fractional duration: the next block really starts at 18:01:02.
    newBlock("fr", { title: "bloc 1", duration: 1.0333 }),
    newBlock("fr", { title: "Nouvelle activité", duration: 10 }),
  ];
  s.days[0].blocks[1].lockedStart = "18:01";
  const [, locked] = scheduleDay(s.days[0]);
  assert.equal(locked.gapMinutes, 0);
  assert.equal(locked.conflict, false);
  s.days[0].blocks[1].lockedStart = "18:00";
  const [, overlapping] = scheduleDay(s.days[0]);
  assert.equal(overlapping.conflict, true, "a real overlap is still reported");
});
