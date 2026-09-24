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
