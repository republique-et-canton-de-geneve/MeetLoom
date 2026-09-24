import test from "node:test";
import assert from "node:assert/strict";
import {
  can,
  createSession,
  elapsedSeconds,
  formatTime,
  newBlock,
  plannedStartTimestamp,
  publicProjection,
  scheduleDay,
  shouldPlayWarning,
  timerView,
  totalDuration,
  transitionRun,
  warningThresholdSeconds,
} from "../shared/domain.js";
import {
  editableSessionSchema,
  runSchema,
  sessionInputSchema,
} from "../shared/validation.js";
import type { Session, SoundSettings } from "../shared/model.js";

function fixture(): Session {
  const session = createSession("owner", "Atelier", "fr");
  session.days[0].blocks = [
    newBlock("fr", { title: "A", duration: 10 }),
    newBlock("fr", { title: "B", duration: 5 }),
    newBlock("fr", { title: "C", duration: 2 }),
  ];
  return session;
}

test("first lock back-calculates preceding blocks; later locks expose gaps and overlaps", () => {
  const session = fixture();
  const day = session.days[0];
  day.blocks[1].lockedStart = "09:20";
  day.blocks[2].lockedStart = "09:22";
  assert.deepEqual(
    scheduleDay(day).map(
      ({ startMinute, endMinute, gapMinutes, conflict }) => ({
        startMinute,
        endMinute,
        gapMinutes,
        conflict,
      }),
    ),
    [
      { startMinute: 550, endMinute: 560, gapMinutes: 0, conflict: false },
      { startMinute: 560, endMinute: 565, gapMinutes: 0, conflict: false },
      { startMinute: 562, endMinute: 564, gapMinutes: -3, conflict: true },
    ],
  );
  day.blocks[0].duration = 25;
  assert.equal(scheduleDay(day)[0].startMinute, 535);
  assert.equal(scheduleDay(day)[1].gapMinutes, 0);
  day.blocks[2].lockedStart = "09:30";
  assert.equal(scheduleDay(day)[2].gapMinutes, 5);
  assert.equal(totalDuration(session), 32);
});

test("formatTime handles midnight crossing and negative preparation times", () => {
  assert.equal(formatTime(1450), "00:10");
  assert.equal(formatTime(-5), "23:55");
});

test("both original demo agendas conform to the schema with independent identities", () => {
  for (const locale of ["fr", "en"] as const) {
    const session = createSession("owner", "Planning", locale, true);
    assert.equal(sessionInputSchema.safeParse(session).success, true);
    assert.equal(totalDuration(session), 90);
    assert.equal(
      new Set(session.days[0].blocks.map((block) => block.id)).size,
      6,
    );
  }
});

test("public projection never serializes team columns, orphan fields or unknown nested properties", () => {
  const session = fixture();
  session.columns.find((column) => column.id === "description")!.visibility =
    "team";
  session.columns.find((column) => column.id === "facilitator")!.visibility =
    "team";
  session.columns.push({
    id: "outcome",
    label: "Outcome",
    visibility: "public",
    visible: false,
  });
  const block = session.days[0].blocks[0];
  block.description = "SECRET_DESCRIPTION";
  block.facilitator = "SECRET_PERSON";
  block.fields = {
    notes: "SECRET_NOTES",
    orphan: "SECRET_ORPHAN",
    outcome: "Public decision",
  };
  Object.assign(session, { credential: "SECRET_TOP" });
  Object.assign(session.days[0], { ownerEmail: "SECRET_DAY" });
  Object.assign(block, { unexpected: "SECRET_BLOCK" });
  Object.assign(session.run, { jwt: "SECRET_RUN" });
  Object.assign(session.columns.at(-1)!, { password: "SECRET_COLUMN" });
  const projected = publicProjection(session);
  assert.equal(JSON.stringify(projected).includes("SECRET"), false);
  assert.equal(
    Object.hasOwn(projected.days[0].blocks[0], "description"),
    false,
  );
  assert.equal(
    Object.hasOwn(projected.days[0].blocks[0], "facilitator"),
    false,
  );
  assert.deepEqual(projected.days[0].blocks[0].fields, {
    outcome: "Public decision",
  });
  assert.equal(
    projected.columns[0].visible,
    false,
    "display hiding is not access control",
  );
  assert.equal(Object.hasOwn(projected, "ownerId"), false);
  assert.equal(Object.hasOwn(projected, "sound"), false);
  projected.days[0].blocks[0].fields.outcome = "Changed client copy";
  assert.equal(block.fields.outcome, "Public decision");
});

test("role permissions do not confuse authentication with organizer authorization", () => {
  assert.equal(can("owner", "share"), true);
  assert.equal(can("editor", "edit"), true);
  assert.equal(can("editor", "share"), false);
  assert.equal(can("facilitator", "run"), true);
  assert.equal(can("facilitator", "edit"), false);
  assert.equal(can("viewer", "run"), false);
});

test("pause, resume and manual next preserve elapsed time and report schedule deviation", () => {
  const original = fixture();
  let session = transitionRun(original, "start", {}, 1000);
  assert.equal(timerView(session, 61_000).remainingSeconds, 540);
  session = transitionRun(session, "pause", {}, 61_000);
  assert.equal(elapsedSeconds(session.run, 91_000), 60);
  session = transitionRun(session, "resume", {}, 91_000);
  assert.equal(elapsedSeconds(session.run, 121_000), 90);
  assert.equal(timerView(session, 121_000).deltaSeconds, 30);
  session = transitionRun(session, "next", {}, 121_000);
  assert.equal(session.run.blockId, session.days[0].blocks[1].id);
  assert.equal(timerView(session, 121_000).deltaSeconds, -480);
  assert.equal(
    session.version,
    original.version,
    "CAS version belongs to storage",
  );
  assert.equal(original.run.status, "idle", "transition must not mutate input");
});

test("automatic polling carries elapsed time through several blocks without drift", () => {
  const session = transitionRun(
    fixture(),
    "start",
    { autoAdvance: true },
    1000,
  );
  const caughtUp = transitionRun(session, "sync", {}, 931_000);
  assert.equal(caughtUp.run.blockId, caughtUp.days[0].blocks[2].id);
  assert.equal(elapsedSeconds(caughtUp.run, 931_000), 30);
  assert.equal(timerView(caughtUp, 931_000).deltaSeconds, 0);
  assert.equal(transitionRun(caughtUp, "sync", {}, 950_000), caughtUp);
  assert.equal(
    transitionRun(caughtUp, "sync", {}, 1_021_000).run.status,
    "finished",
  );
});

test("automatic transitions occur exactly at the boundary and never advance during a pause", () => {
  let session = transitionRun(fixture(), "start", { autoAdvance: true }, 1000);
  const originalBlock = session.run.blockId;
  assert.equal(transitionRun(session, "sync", {}, 600_999), session);
  session = transitionRun(session, "sync", {}, 601_000);
  assert.notEqual(session.run.blockId, originalBlock);
  assert.equal(elapsedSeconds(session.run, 601_000), 0);
  session = transitionRun(session, "pause", {}, 661_000);
  assert.equal(transitionRun(session, "sync", {}, 1_661_000), session);
  assert.equal(timerView(session, 1_661_000).remainingSeconds, 240);
});

test("duration extensions and agenda edits preserve the original timing baseline", () => {
  let session = transitionRun(fixture(), "start", {}, 1000);
  const firstId = session.days[0].blocks[0].id;
  const secondId = session.days[0].blocks[1].id;
  assert.equal(session.run.plannedDurations?.[firstId], 600);
  session = transitionRun(session, "extend", { seconds: 120 }, 651_000);
  assert.equal(timerView(session, 651_000).remainingSeconds, 70);
  assert.equal(
    timerView(session, 651_000).deltaSeconds,
    50,
    "extra time must not erase an existing delay",
  );
  session.days[0].blocks[1].duration = 10;
  session = transitionRun(session, "next", {}, 721_000);
  assert.equal(session.run.completedDuration, 600);
  assert.equal(timerView(session, 721_000).deltaSeconds, 120);
  assert.equal(
    session.run.plannedDurations?.[secondId],
    300,
    "later agenda edits must not rewrite the baseline",
  );
  session = transitionRun(session, "next", {}, 1_321_000);
  assert.equal(session.run.completedDuration, 900);
  assert.equal(timerView(session, 1_321_000).deltaSeconds, 420);
  session = transitionRun(session, "previous", {}, 1_321_000);
  assert.equal(
    session.run.completedDuration,
    600,
    "previous subtracts initial, not modified duration",
  );
  session = transitionRun(session, "reset", {}, 1_322_000);
  assert.equal(session.run.plannedDurations, undefined);
  session = transitionRun(session, "start", {}, 1_323_000);
  assert.equal(
    session.run.plannedDurations?.[firstId],
    720,
    "a new run captures a new baseline",
  );
  assert.equal(session.run.plannedDurations?.[secondId], 600);
});

test("public timing baseline includes only numeric durations for public block IDs", () => {
  const session = transitionRun(fixture(), "start", {}, 1000);
  session.run.plannedDurations!.SECRET_REMOVED_BLOCK = 120;
  const projected = publicProjection(session);
  assert.equal(
    JSON.stringify(projected).includes("SECRET_REMOVED_BLOCK"),
    false,
  );
  assert.equal(timerView(projected, 651_000).deltaSeconds, 50);
  const firstId = session.days[0].blocks[0].id;
  projected.run.plannedDurations![firstId] = 100;
  assert.equal(
    session.run.plannedDurations![firstId],
    600,
    "projection cannot mutate the stored snapshot",
  );
});

test("planned durations have bounded numeric values and support legacy runs", () => {
  const session = fixture();
  assert.equal(runSchema.safeParse(session.run).success, true);
  for (const value of [-1, 86_401, Infinity, NaN]) {
    assert.equal(
      runSchema.safeParse({
        ...session.run,
        plannedDurations: { block: value },
      }).success,
      false,
    );
  }
  assert.equal(
    runSchema.safeParse({
      ...session.run,
      plannedDurations: Object.fromEntries(
        Array.from({ length: 1001 }, (_, i) => [`block-${i}`, 60]),
      ),
    }).success,
    false,
  );
  assert.equal(
    runSchema.safeParse({
      ...session.run,
      plannedDurations: JSON.parse('{"constructor":60}'),
    }).success,
    false,
  );
});

test("manual overrun waits for next, and previous, extension and reset behave predictably", () => {
  let session = transitionRun(fixture(), "start", {}, 1000);
  assert.equal(transitionRun(session, "sync", {}, 701_000), session);
  assert.equal(timerView(session, 701_000).remainingSeconds, -100);
  session = transitionRun(session, "extend", { seconds: 120 }, 701_000);
  assert.equal(timerView(session, 701_000).remainingSeconds, 20);
  session = transitionRun(session, "pause", {}, 701_000);
  session = transitionRun(session, "next", {}, 702_000);
  assert.equal(session.run.status, "paused");
  session = transitionRun(session, "previous", {}, 703_000);
  assert.equal(session.run.blockId, session.days[0].blocks[0].id);
  assert.equal(session.run.completedDuration, 0);
  session = transitionRun(session, "reset", {}, 704_000);
  assert.equal(session.run.status, "idle");
  assert.equal(session.run.blockId, null);
  assert.throws(() =>
    transitionRun(
      transitionRun(fixture(), "start", {}, 1000),
      "extend",
      { seconds: -60 },
      1001,
    ),
  );
  assert.throws(() =>
    transitionRun(fixture(), "start", { dayId: "missing" }, 1000),
  );
  assert.throws(() =>
    transitionRun(fixture(), "reset", { dayId: "missing" }, 1000),
  );
});

test("minute and percentage sound thresholds cross once and skip short blocks", () => {
  const sound: SoundSettings = {
    enabled: true,
    mode: "minutes",
    value: 2,
    atEnd: true,
    volume: 0.5,
    sound: "bell",
  };
  assert.equal(warningThresholdSeconds(sound, 600), 120);
  assert.equal(warningThresholdSeconds(sound, 120), null);
  assert.equal(shouldPlayWarning(sound, 600, 130, 110), true);
  assert.equal(shouldPlayWarning(sound, 600, 130, 110, true), false);
  assert.equal(shouldPlayWarning(sound, 600, 110, 109), false);
  assert.equal(
    shouldPlayWarning(sound, 600, 130, -1),
    false,
    "do not replay stale warning after block end",
  );
  sound.mode = "percent";
  sound.value = 20;
  assert.equal(warningThresholdSeconds(sound, 900), 180);
  assert.equal(shouldPlayWarning(sound, 900, 181, 180), true);
  sound.enabled = false;
  assert.equal(shouldPlayWarning(sound, 900, 181, 180), false);
  assert.equal(warningThresholdSeconds(sound, 900), null);
});

test("validation rejects duplicate IDs, unknown fields, nested objects and malformed timing", () => {
  const invalid: Array<(session: Session) => void> = [
    (session) => {
      session.days[0].blocks[1].id = session.days[0].blocks[0].id;
    },
    (session) => {
      session.columns.push({ ...session.columns[0] });
    },
    (session) => {
      session.days.push({ ...session.days[0] });
    },
    (session) => {
      session.days[0].blocks[0].fields.missing = "No column";
    },
    (session) => {
      session.days[0].blocks[0].fields = JSON.parse('{"__proto__":"unsafe"}');
    },
    (session) => {
      session.days[0].blocks[0].fields = JSON.parse('{"constructor":"unsafe"}');
    },
    (session) => {
      (
        session.days[0].blocks[0].fields as unknown as Record<string, unknown>
      ).notes = { nested: "x" };
    },
    (session) => {
      session.days[0].date = "2026-02-30";
    },
    (session) => {
      session.days[0].startTime = "25:00";
    },
    (session) => {
      session.days[0].blocks[0].duration = -1;
    },
    (session) => {
      Object.assign(session.days[0].blocks[0], { private: "unexpected" });
    },
    (session) => {
      session.run.dayId = "missing";
    },
  ];
  for (const change of invalid) {
    const session = fixture();
    change(session);
    assert.equal(sessionInputSchema.safeParse(session).success, false);
  }
  const session = fixture();
  assert.equal(
    editableSessionSchema.safeParse(session).success,
    false,
    "server fields forbidden in editable payload",
  );
  const { id, ownerId, run, version, createdAt, updatedAt, ...editable } =
    session;
  assert.equal(editableSessionSchema.safeParse(editable).success, true);
});

test("zero-minute milestones validate and auto-advance without drift or infinite loops", () => {
  const original = fixture();
  original.days[0].blocks[0].duration = 0;
  original.days[0].blocks[1].duration = 0;
  assert.equal(sessionInputSchema.safeParse(original).success, true);
  const running = transitionRun(original, "start", { autoAdvance: true }, 1000);
  assert.equal(running.run.blockId, original.days[0].blocks[2].id);
  assert.equal(timerView(running, 1000).remainingSeconds, 120);
  assert.equal(running.run.actualDurations?.[original.days[0].blocks[0].id], 0);
  assert.equal(sessionInputSchema.safeParse(running).success, true);
  original.days[0].blocks[2].duration = 0;
  assert.equal(
    transitionRun(original, "start", { autoAdvance: true }, 1000).run.status,
    "finished",
  );
});

test("planned starts use agenda timezone, first lock and explicit DST behavior", () => {
  const session = fixture();
  const day = session.days[0];
  day.date = "2026-09-23";
  day.blocks[1].lockedStart = "09:20";
  assert.equal(
    plannedStartTimestamp(session, day.id),
    Date.parse("2026-09-23T07:10:00Z"),
  );
  const now = Date.parse("2026-09-23T07:22:00Z");
  const started = transitionRun(
    session,
    "start",
    { startMode: "planned", autoAdvance: true },
    now,
  );
  assert.equal(started.run.blockId, day.blocks[1].id);
  assert.equal(elapsedSeconds(started.run, now), 120);
  assert.equal(timerView(started, now).deltaSeconds, 0);
  const early = transitionRun(
    session,
    "start",
    { startMode: "planned" },
    Date.parse("2026-09-23T07:00:00Z"),
  );
  assert.equal(
    timerView(early, Date.parse("2026-09-23T07:00:00Z")).startsInSeconds,
    600,
    "a start still ahead counts down to it",
  );
  day.date = "2026-03-29";
  day.blocks[1].lockedStart = "02:40";
  assert.throws(() => plannedStartTimestamp(session, day.id), /does not exist/);
  day.date = "2026-10-25";
  assert.equal(
    plannedStartTimestamp(session, day.id),
    Date.parse("2026-10-25T00:30:00Z"),
  );
});

test("completed runs retain real durations and explicitly apply or restore them", () => {
  const original = fixture(),
    first = original.days[0].blocks[0].id,
    second = original.days[0].blocks[1].id;
  let session = transitionRun(original, "start", {}, 1000);
  session = transitionRun(session, "next", {}, 61_000);
  session = transitionRun(session, "pause", {}, 91_000);
  session = transitionRun(session, "resume", {}, 111_000);
  session = transitionRun(session, "stop", {}, 141_000);
  assert.equal(session.run.actualDurations?.[first], 60);
  assert.equal(
    session.run.actualDurations?.[second],
    60,
    "paused time is excluded from speaking duration",
  );
  assert.equal(
    session.days[0].blocks[0].duration,
    10,
    "finishing does not rewrite the agenda",
  );
  const actual = transitionRun(session, "apply-actual", {}, 150_000);
  assert.deepEqual(
    actual.days[0].blocks.map((block) => block.duration),
    [1, 1, 2],
  );
  const restored = transitionRun(actual, "restore-plan", {}, 151_000);
  assert.deepEqual(
    restored.days[0].blocks.map((block) => block.duration),
    [10, 5, 2],
  );
  session.run.actualDurations!.SECRET_REMOVED_BLOCK = 3;
  assert.equal(
    JSON.stringify(publicProjection(session)).includes("SECRET_REMOVED_BLOCK"),
    false,
  );
  assert.equal(sessionInputSchema.safeParse(restored).success, true);
  assert.throws(() =>
    transitionRun(
      transitionRun(original, "start", {}, 1000),
      "apply-actual",
      {},
      2000,
    ),
  );
  let revisited = transitionRun(original, "start", {}, 1000);
  revisited = transitionRun(revisited, "next", {}, 61_000);
  revisited = transitionRun(revisited, "previous", {}, 91_000);
  revisited = transitionRun(revisited, "stop", {}, 111_000);
  assert.equal(
    revisited.run.actualDurations?.[first],
    110,
    "revisits keep the time already spent and the detour",
  );
});

test("validation bounds total blocks across days and field text size", () => {
  const session = fixture();
  session.days = [0, 1].map((index) => ({
    ...session.days[0],
    id: `day-${index}`,
    blocks: Array.from({ length: 501 }, () => newBlock("fr")),
  }));
  session.run.dayId = session.days[0].id;
  assert.equal(sessionInputSchema.safeParse(session).success, false);
  const longField = fixture();
  longField.days[0].blocks[0].fields.notes = "x".repeat(30_001);
  assert.equal(sessionInputSchema.safeParse(longField).success, false);
});
