import test from "node:test";
import assert from "node:assert/strict";
import { createSession, newBlock, transitionRun } from "../shared/domain.js";
import { timerMinimapView, timerVisualState } from "../shared/timer-visual.js";
test("visual traffic-light thresholds are exact at 20 and 5 percent, independent from chimes", () => {
  assert.equal(timerVisualState(120.01, 600), "normal");
  assert.equal(timerVisualState(120, 600), "warning");
  assert.equal(timerVisualState(30.01, 600), "warning");
  assert.equal(timerVisualState(30, 600), "critical");
  assert.equal(timerVisualState(-1, 600), "critical");
  assert.equal(timerVisualState(0, 0), "normal");
});
test("minimap progresses across grouped blocks, freezes on pause and remains colored with muted sound", () => {
  let session = createSession("owner", "Timer", "en");
  const first = newBlock("en", { duration: 5 }),
    second = newBlock("en", { duration: 5 });
  const group = newBlock("en", {
    kind: "group",
    children: [first, second],
    duration: 10,
  });
  session.days[0].blocks = [group];
  session.sound.enabled = false;
  session = transitionRun(
    session,
    "start",
    { dayId: session.days[0].id, blockId: first.id },
    100000,
  );
  session = transitionRun(session, "next", {}, 400000);
  const view = timerMinimapView(session, group, 640000);
  assert.equal(view.active, true);
  assert.equal(view.progress, 0.9);
  assert.equal(view.state, "warning");
  session = transitionRun(session, "pause", {}, 640000);
  assert.deepEqual(timerMinimapView(session, group, 900000), view);
});
