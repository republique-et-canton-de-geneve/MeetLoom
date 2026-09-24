import test from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  newBlock,
  publicProjection,
  timerView,
  transitionRun,
} from "../shared/domain.js";
import type { Session } from "../shared/model.js";
import { sessionInputSchema } from "../shared/validation.js";
import { timerAudioStep } from "../src/Timer.tsx";
import { harness } from "./support.js";

// Seconds are expressed from the run start at t = 0 to keep scenarios readable.
const at = (seconds: number) => 1_000_000 + seconds * 1000;

function plan(...minutes: number[]) {
  const session = createSession("owner", "Revisit", "en", false);
  session.days[0].blocks = minutes.map((duration, index) =>
    newBlock("en", { title: `Block ${index + 1}`, duration }),
  );
  return session;
}
const ids = (session: Session) => session.days[0].blocks.map((b) => b.id);
function setDuration(session: Session, index: number, minutes: number) {
  const edited = structuredClone(session);
  edited.days[0].blocks[index].duration = minutes;
  return edited;
}
function start(session: Session, autoAdvance = false) {
  return transitionRun(session, "start", { autoAdvance }, at(0));
}

test("reported scenario: leaving with 30 s left and returning 10 s later leaves 20 s", () => {
  let s = start(plan(1, 1));
  const [first, second] = ids(s);
  s = transitionRun(s, "next", {}, at(30));
  assert.equal(s.run.blockId, second);
  s = transitionRun(s, "previous", {}, at(40));
  assert.equal(s.run.blockId, first);
  assert.equal(s.run.status, "running");
  const back = timerView(s, at(40));
  assert.equal(back.elapsedSeconds, 40, "the clock kept running for block 1");
  assert.equal(back.remainingSeconds, 20);
  assert.equal(timerView(s, at(50)).remainingSeconds, 10, "keeps counting");
  assert.equal(timerView(s, at(60)).remainingSeconds, 0);
  assert.equal(sessionInputSchema.safeParse(s).success, true);
});

test("returning to a block extended in the agenda counts against its new duration", () => {
  // Two one-minute blocks; advance after 30 s, give block 1 one more minute,
  // then go back to it 5 s later.
  let s = start(plan(1, 1));
  s = transitionRun(s, "next", {}, at(30));
  s = setDuration(s, 0, 2);
  s = transitionRun(s, "previous", {}, at(35));
  const view = timerView(s, at(35));
  assert.equal(view.elapsedSeconds, 35);
  assert.equal(view.remainingSeconds, 85, "2 min minus 35 s");
  assert.equal(timerView(s, at(120)).remainingSeconds, 0);
});

test("going back immediately resumes exactly where the block was left", () => {
  let s = start(plan(1, 1));
  s = transitionRun(s, "next", {}, at(30));
  s = transitionRun(s, "previous", {}, at(30));
  const view = timerView(s, at(30));
  assert.equal(view.remainingSeconds, 30);
  assert.ok(Math.abs(view.progress - 0.5) < 1e-9);
});

test("the block left by going back becomes upcoming again and restarts fresh", () => {
  let s = start(plan(1, 1));
  const [first, second] = ids(s);
  s = transitionRun(s, "next", {}, at(30));
  s = transitionRun(s, "previous", {}, at(45));
  assert.equal(
    Object.hasOwn(s.run.actualDurations ?? {}, second),
    false,
    "the 15 s spent on block 2 now belong to block 1",
  );
  assert.equal(
    Object.hasOwn(s.run.actualDurations ?? {}, first),
    false,
    "block 1 is live again, so its time is in the running clock",
  );
  s = transitionRun(s, "next", {}, at(55));
  assert.equal(s.run.blockId, second);
  assert.equal(timerView(s, at(55)).remainingSeconds, 60);
  assert.equal(s.run.actualDurations?.[first], 55);
});

test("going back while paused keeps the timer paused at the resumed position", () => {
  let s = start(plan(2, 2));
  const [first] = ids(s);
  s = transitionRun(s, "pause", {}, at(40));
  s = transitionRun(s, "next", {}, at(50));
  assert.equal(s.run.status, "paused");
  s = transitionRun(s, "previous", {}, at(60));
  assert.equal(s.run.status, "paused");
  assert.equal(s.run.blockId, first);
  assert.equal(s.run.startedAt, null);
  assert.equal(
    timerView(s, at(60)).remainingSeconds,
    80,
    "no time ran while paused",
  );
  assert.equal(
    timerView(s, at(500)).remainingSeconds,
    80,
    "frozen while paused",
  );
  s = transitionRun(s, "resume", {}, at(500));
  assert.equal(timerView(s, at(510)).remainingSeconds, 70);
});

test("running detour time counts, paused time does not", () => {
  let s = start(plan(2, 2));
  s = transitionRun(s, "next", {}, at(20));
  s = transitionRun(s, "pause", {}, at(25));
  s = transitionRun(s, "previous", {}, at(300));
  s = transitionRun(s, "resume", {}, at(310));
  assert.equal(timerView(s, at(310)).elapsedSeconds, 25);
});

test("the timer bar's +1 min after going back adds to the remaining time", () => {
  let s = start(plan(1, 1));
  s = transitionRun(s, "next", {}, at(30));
  s = transitionRun(s, "previous", {}, at(40));
  s = transitionRun(s, "extend", { seconds: 60 }, at(40));
  assert.equal(s.days[0].blocks[0].duration, 2);
  assert.equal(timerView(s, at(40)).remainingSeconds, 80);
});

test("shortening a block before returning to it resumes into overtime rather than restarting", () => {
  let s = start(plan(2, 2));
  s = transitionRun(s, "next", {}, at(90));
  s = setDuration(s, 0, 1);
  s = transitionRun(s, "previous", {}, at(100));
  assert.equal(timerView(s, at(100)).remainingSeconds, -40);
});

test("an overrun block resumes in overtime when revisited", () => {
  let s = start(plan(1, 1));
  s = transitionRun(s, "next", {}, at(75));
  s = transitionRun(s, "previous", {}, at(80));
  assert.equal(timerView(s, at(80)).remainingSeconds, -20);
  assert.equal(timerView(s, at(80)).progress, 1);
});

test("several steps back carry every detour back to the earliest block", () => {
  let s = start(plan(1, 1, 1));
  const [first, second, third] = ids(s);
  s = transitionRun(s, "next", {}, at(20));
  s = transitionRun(s, "next", {}, at(60));
  assert.equal(s.run.blockId, third);
  s = transitionRun(s, "previous", {}, at(70));
  assert.equal(s.run.blockId, second);
  assert.equal(timerView(s, at(70)).elapsedSeconds, 50, "40 s + 10 s detour");
  assert.equal(Object.hasOwn(s.run.actualDurations ?? {}, third), false);
  s = transitionRun(s, "previous", {}, at(75));
  assert.equal(s.run.blockId, first);
  assert.equal(
    timerView(s, at(75)).elapsedSeconds,
    75,
    "every second since the start now belongs to block 1",
  );
  assert.equal(Object.hasOwn(s.run.actualDurations ?? {}, second), false);
  assert.equal(
    transitionRun(s, "previous", {}, at(76)),
    s,
    "no block before 1",
  );
});

test("repeated round trips keep counting on the revisited block", () => {
  let s = start(plan(2, 2));
  const [first] = ids(s);
  s = transitionRun(s, "next", {}, at(20));
  s = transitionRun(s, "previous", {}, at(25));
  s = transitionRun(s, "next", {}, at(35));
  s = transitionRun(s, "previous", {}, at(40));
  assert.equal(timerView(s, at(40)).elapsedSeconds, 40);
  s = transitionRun(s, "stop", {}, at(50));
  assert.equal(s.run.actualDurations?.[first], 50);
});

test("actual durations after a round trip give the real time per block", () => {
  let s = start(plan(1, 1));
  s = transitionRun(s, "next", {}, at(30));
  s = setDuration(s, 0, 2);
  s = transitionRun(s, "previous", {}, at(35));
  s = transitionRun(s, "next", {}, at(125));
  s = transitionRun(s, "next", {}, at(185));
  assert.equal(s.run.status, "finished");
  assert.equal(s.run.actualDurations?.[ids(s)[0]], 125);
  assert.equal(s.run.actualDurations?.[ids(s)[1]], 60);
  const restored = transitionRun(s, "restore-plan", {}, at(190));
  assert.deepEqual(
    restored.days[0].blocks.map((block) => block.duration),
    [1, 1],
    "the baseline captured at start is unchanged",
  );
});

test("a detour is not counted as lost time against the schedule", () => {
  let s = start(plan(1, 1));
  s = transitionRun(s, "next", {}, at(30));
  s = transitionRun(s, "previous", {}, at(45));
  assert.equal(s.run.completedDuration, 0);
  assert.equal(timerView(s, at(45)).deltaSeconds, 0);
  assert.equal(timerView(s, at(75)).deltaSeconds, 15, "overrun is delay");
});

test("automatic advance after going back fires at the block's real end", () => {
  let s = start(plan(1, 1), true);
  const [first, second] = ids(s);
  s = transitionRun(s, "next", {}, at(30));
  s = transitionRun(s, "previous", {}, at(40));
  assert.equal(transitionRun(s, "sync", {}, at(59)).run.blockId, first);
  const advanced = transitionRun(s, "sync", {}, at(60));
  assert.equal(advanced.run.blockId, second);
  assert.equal(advanced.run.actualDurations?.[first], 60);
  assert.equal(timerView(advanced, at(60)).remainingSeconds, 60);
});

test("an extended block revisited in automatic mode ends at its new duration", () => {
  let s = start(plan(1, 1), true);
  const [first, second] = ids(s);
  s = transitionRun(s, "next", {}, at(30));
  s = setDuration(s, 0, 2);
  s = transitionRun(s, "previous", {}, at(35));
  assert.equal(transitionRun(s, "sync", {}, at(119)).run.blockId, first);
  assert.equal(transitionRun(s, "sync", {}, at(120)).run.blockId, second);
});

test("runs recorded before this change, without actual durations, still go back safely", () => {
  let s = start(plan(1, 1));
  s = transitionRun(s, "next", {}, at(30));
  delete s.run.actualDurations;
  s = transitionRun(s, "previous", {}, at(40));
  assert.equal(timerView(s, at(40)).remainingSeconds, 50);
  assert.equal(sessionInputSchema.safeParse(s).success, true);
});

test("visitors see the resumed countdown, not a restarted one", () => {
  let s = start(plan(1, 1));
  s = transitionRun(s, "next", {}, at(30));
  s = setDuration(s, 0, 2);
  s = transitionRun(s, "previous", {}, at(35));
  const visitor = publicProjection(s);
  assert.equal(timerView(visitor, at(35)).remainingSeconds, 85);
  assert.equal(timerView(visitor, at(35)).elapsedSeconds, 35);
});

test("audio: added time re-arms the warning and the end chime within one block", () => {
  let s = plan(2, 2);
  s.sound = { ...s.sound, mode: "minutes", value: 1, atEnd: true };
  s = start(s);
  let frame = timerAudioStep(null, s, at(0), true).frame;
  const warned = timerAudioStep(frame, s, at(61), true);
  assert.equal(warned.warning, true);
  const ended = timerAudioStep(warned.frame, s, at(121), true);
  assert.equal(ended.end, true);
  frame = ended.frame;
  // Overtime, then +2 min from the timer bar: 99 s remain again.
  const extended = transitionRun(s, "extend", { seconds: 120 }, at(121));
  frame = timerAudioStep(frame, extended, at(121), true).frame;
  assert.equal(timerAudioStep(frame, extended, at(150), true).warning, false);
  const again = timerAudioStep(frame, extended, at(181), true);
  assert.equal(again.warning, true, "one minute left again");
  const endAgain = timerAudioStep(again.frame, extended, at(241), true);
  assert.equal(endAgain.end, true);
  assert.equal(
    timerAudioStep(endAgain.frame, extended, at(242), true).end,
    false,
  );
});

test("API: a facilitator going back resumes the block's elapsed time", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  const path = `/sessions/${session.id}`;
  const [first] = session.days[0].blocks;
  const started = await h.owner.request(path + "/run", "POST", {
    action: "start",
    dayId: session.days[0].id,
  });
  assert.equal(started.status, 200);
  const paused = await h.owner.request(path + "/run", "POST", {
    action: "pause",
  });
  assert.equal(paused.status, 200);
  // Pausing freezes the time spent on the first block so it can be compared.
  const next = await h.owner.request(path + "/run", "POST", { action: "next" });
  assert.equal(next.status, 200);
  const spent = next.body.session.run.actualDurations[first.id];
  assert.equal(typeof spent, "number");
  const back = await h.owner.request(path + "/run", "POST", {
    action: "previous",
  });
  assert.equal(back.status, 200);
  assert.equal(back.body.session.run.blockId, first.id);
  assert.equal(back.body.session.run.status, "paused");
  assert.equal(back.body.session.run.elapsedBeforePause, spent);
  assert.equal(
    Object.hasOwn(back.body.session.run.actualDurations, first.id),
    false,
  );
});
