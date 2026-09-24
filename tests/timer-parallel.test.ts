import test from "node:test";
import assert from "node:assert/strict";
import {
  blockDuration,
  createSession,
  newBlock,
  publicProjection,
  runnableBlocks,
  timerView,
  transitionRun,
} from "../shared/domain.js";
import type { Session } from "../shared/model.js";
import { sessionInputSchema } from "../shared/validation.js";

const at = (seconds: number) => 1_000_000 + seconds * 1000;

/** Intro (2 min) → rooms A: 3+2 min, B: 4 min → wrap-up (1 min). */
function plan() {
  const s = createSession("owner", "Parallel", "en", false);
  const parallel = newBlock("en", {
    title: "Rooms",
    kind: "parallel",
    rooms: [
      {
        id: "room-a",
        title: "Room A",
        blocks: [
          newBlock("en", { title: "A1", duration: 3 }),
          newBlock("en", { title: "A2", duration: 2 }),
        ],
      },
      {
        id: "room-b",
        title: "Room B",
        blocks: [newBlock("en", { title: "B1", duration: 4 })],
      },
    ],
  });
  s.days[0].blocks = [
    newBlock("en", { title: "Intro", duration: 2 }),
    parallel,
    newBlock("en", { title: "Wrap-up", duration: 1 }),
  ];
  return s;
}
const titles = (s: Session) =>
  runnableBlocks(s.days[0].blocks).map((block) => block.title);
const parallelOf = (s: Session) => s.days[0].blocks[1];

test("a parallel block is one timer step lasting as long as its longest room", () => {
  const s = plan();
  assert.deepEqual(titles(s), ["Intro", "Rooms", "Wrap-up"]);
  assert.equal(blockDuration(parallelOf(s)), 5);
  assert.equal(parallelOf(s).duration, 5);
});

test("the timer starts on a day with parallel rooms and walks through them", () => {
  let s = transitionRun(plan(), "start", {}, at(0));
  assert.equal(s.run.status, "running");
  assert.equal(timerView(s, at(0)).block?.title, "Intro");
  s = transitionRun(s, "next", {}, at(120));
  assert.equal(timerView(s, at(120)).block?.title, "Rooms");
  assert.equal(timerView(s, at(120)).remainingSeconds, 300);
  assert.equal(timerView(s, at(420)).remainingSeconds, 0);
  s = transitionRun(s, "next", {}, at(420));
  assert.equal(timerView(s, at(420)).block?.title, "Wrap-up");
  assert.equal(timerView(s, at(420)).deltaSeconds, 0);
  assert.equal(sessionInputSchema.safeParse(s).success, true);
});

test("automatic advance leaves the parallel block when the longest room ends", () => {
  let s = transitionRun(plan(), "start", { autoAdvance: true }, at(0));
  s = transitionRun(s, "sync", {}, at(419));
  assert.equal(timerView(s, at(419)).block?.title, "Rooms");
  s = transitionRun(s, "sync", {}, at(420));
  assert.equal(timerView(s, at(420)).block?.title, "Wrap-up");
  assert.equal(s.run.actualDurations?.[parallelOf(s).id], 300);
});

test("adding time to a running parallel block lengthens its longest room", () => {
  let s = transitionRun(plan(), "start", {}, at(0));
  s = transitionRun(s, "next", {}, at(120));
  s = transitionRun(s, "extend", { seconds: 60 }, at(150));
  assert.equal(parallelOf(s).duration, 6);
  const [roomA, roomB] = parallelOf(s).rooms!;
  assert.deepEqual(
    roomA.blocks.map((block) => block.duration),
    [3, 3],
    "the last activity of the longest room receives the minute",
  );
  assert.deepEqual(
    roomB.blocks.map((block) => block.duration),
    [4],
  );
  assert.equal(timerView(s, at(150)).remainingSeconds, 330);
  assert.equal(sessionInputSchema.safeParse(s).success, true);
});

test("editing a room while the parallel block runs updates its countdown", () => {
  let s = transitionRun(plan(), "start", {}, at(0));
  s = transitionRun(s, "next", {}, at(120));
  const edited = structuredClone(s);
  edited.days[0].blocks[1].rooms![1].blocks[0].duration = 7;
  edited.days[0].blocks[1].duration = blockDuration(edited.days[0].blocks[1]);
  assert.equal(timerView(edited, at(180)).remainingSeconds, 360);
});

test("going back from the wrap-up to the parallel block resumes it", () => {
  let s = transitionRun(plan(), "start", {}, at(0));
  s = transitionRun(s, "next", {}, at(120));
  s = transitionRun(s, "next", {}, at(360));
  s = transitionRun(s, "previous", {}, at(370));
  assert.equal(timerView(s, at(370)).block?.title, "Rooms");
  assert.equal(timerView(s, at(370)).remainingSeconds, 50);
});

test("the automatic extension of a finished parallel block rewinds to it", () => {
  let s = transitionRun(plan(), "start", { autoAdvance: true }, at(0));
  s = transitionRun(s, "sync", {}, at(430));
  assert.equal(timerView(s, at(430)).block?.title, "Wrap-up");
  s = transitionRun(
    s,
    "extend",
    { blockId: parallelOf(s).id, seconds: 60 },
    at(430),
  );
  assert.equal(timerView(s, at(430)).block?.title, "Rooms");
  assert.equal(timerView(s, at(430)).remainingSeconds, 50);
});

test("visitors follow the parallel block in the public timer", () => {
  let s = transitionRun(plan(), "start", {}, at(0));
  s = transitionRun(s, "next", {}, at(120));
  const visitor = publicProjection(s);
  assert.equal(timerView(visitor, at(180)).block?.title, "Rooms");
  assert.equal(timerView(visitor, at(180)).remainingSeconds, 240);
});

test("a parallel day can start from its first room-free step directly", () => {
  const s = plan();
  const started = transitionRun(
    s,
    "start",
    { blockId: parallelOf(s).id },
    at(0),
  );
  assert.equal(timerView(started, at(0)).block?.title, "Rooms");
});
