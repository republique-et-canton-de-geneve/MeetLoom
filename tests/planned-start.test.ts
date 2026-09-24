import test from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  newBlock,
  plannedStartTimestamp,
  timerView,
  transitionRun,
} from "../shared/domain.js";
import {
  plannedStartCountdownLabel,
  plannedStartUnavailableReason,
  timerAudioStep,
} from "../src/Timer.tsx";

// 24 September 2026, 08:53 in Zurich (UTC+2); the day starts at 09:00.
const now = Date.UTC(2026, 8, 24, 6, 53);
const nine = Date.UTC(2026, 8, 24, 7, 0);

function plan() {
  const s = createSession("owner", "Planned", "fr", false);
  s.timezone = "Europe/Zurich";
  s.days[0].date = "2026-09-24";
  s.days[0].startTime = "09:00";
  s.days[0].blocks = [
    newBlock("fr", { title: "A", duration: 2 }),
    newBlock("fr", { title: "B", duration: 1 }),
  ];
  return s;
}

test("starting from a scheduled time still ahead counts down, then runs on time", () => {
  const s = transitionRun(plan(), "start", { startMode: "planned" }, now);
  assert.equal(plannedStartTimestamp(s, s.days[0].id), nine);
  assert.equal(s.run.status, "running");
  assert.equal(s.run.startedAt, nine);
  const waiting = timerView(s, now);
  assert.equal(waiting.startsInSeconds, 420, "7 minutes until 09:00");
  assert.equal(waiting.elapsedSeconds, 0);
  assert.equal(waiting.remainingSeconds, 120, "the block is untouched");
  assert.equal(waiting.deltaSeconds, 0);
  const started = timerView(s, nine + 30_000);
  assert.equal(started.startsInSeconds, 0);
  assert.equal(started.remainingSeconds, 90);
  assert.equal(started.deltaSeconds, 0);
});

test("automatic advance waits for the scheduled start before counting", () => {
  const s = transitionRun(
    plan(),
    "start",
    { startMode: "planned", autoAdvance: true },
    now,
  );
  assert.equal(
    transitionRun(s, "sync", {}, nine + 119_000).run.blockId,
    s.days[0].blocks[0].id,
  );
  assert.equal(
    transitionRun(s, "sync", {}, nine + 120_000).run.blockId,
    s.days[0].blocks[1].id,
  );
});

test("pausing during the countdown and resuming starts the block immediately", () => {
  let s = transitionRun(plan(), "start", { startMode: "planned" }, now);
  s = transitionRun(s, "pause", {}, now + 60_000);
  assert.equal(timerView(s, now + 60_000).elapsedSeconds, 0);
  s = transitionRun(s, "resume", {}, now + 90_000);
  assert.equal(timerView(s, now + 100_000).startsInSeconds, 0);
  assert.equal(timerView(s, now + 100_000).remainingSeconds, 110);
});

test("the end-of-block chime is scheduled from the planned start", () => {
  const s = transitionRun(plan(), "start", { startMode: "planned" }, now);
  const frame = timerAudioStep(null, s, now, true).frame;
  assert.equal(frame.deadline, nine + 120_000);
});

test("the start option explains the countdown and remains available", () => {
  assert.equal(plannedStartUnavailableReason(nine, now, "fr"), null);
  assert.equal(
    plannedStartCountdownLabel(nine, now, "Europe/Zurich", "fr"),
    "décompte jusqu’à 09:00",
  );
  assert.equal(
    plannedStartCountdownLabel(nine, now, "Europe/Zurich", "en"),
    "countdown until 09:00",
  );
  assert.match(
    plannedStartCountdownLabel(nine + 86_400_000, now, "Europe/Zurich", "fr"),
    /^décompte jusqu’à 25 sept\.?,? 09:00$/,
  );
});

test("an unusable or very distant schedule is still explained", () => {
  assert.equal(
    plannedStartUnavailableReason(null, now, "en"),
    "check the start date and time",
  );
  assert.equal(
    plannedStartUnavailableReason(now - 100_000_000_001, now, "fr"),
    "heure prévue trop éloignée",
  );
  assert.throws(() =>
    transitionRun(
      plan(),
      "start",
      { startMode: "planned" },
      nine - 100_000_000_001,
    ),
  );
});

test("the planned start is the day's start time, never a minute earlier", () => {
  // Reported: a 1-minute first block and a second block locked at the day's
  // start used to back-calculate the day to 13:29.
  const s = plan();
  s.days[0].startTime = "13:30";
  s.days[0].blocks[0].duration = 1;
  s.days[0].blocks[1].lockedStart = "13:30";
  const at1330 = Date.UTC(2026, 8, 24, 11, 30);
  assert.equal(plannedStartTimestamp(s, s.days[0].id), at1330);
  // A stale lock on the first block no longer moves the day either.
  s.days[0].blocks[0].lockedStart = "12:30";
  assert.equal(plannedStartTimestamp(s, s.days[0].id), at1330);
  const started = transitionRun(
    s,
    "start",
    { startMode: "planned" },
    at1330 - 90_000,
  );
  assert.equal(timerView(started, at1330 - 90_000).startsInSeconds, 90);
  assert.equal(timerView(started, at1330).startsInSeconds, 0);
});
