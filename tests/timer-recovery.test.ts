import test from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  newBlock,
  transitionRun,
  reconcileAutomaticExtension,
  timerView,
  publicProjection,
} from "../shared/domain.js";
import { sessionInputSchema } from "../shared/validation.js";
import { harness } from "./support.js";
function plan() {
  const s = createSession("owner", "Timer", "en", false);
  s.days[0].blocks = [
    newBlock("en", { title: "A", duration: 10 }),
    newBlock("en", { title: "B", duration: 5 }),
  ];
  return s;
}
test("extending the previous automatic block rewinds with its elapsed time and original baseline", () => {
  let s = transitionRun(plan(), "start", { autoAdvance: true }, 1000);
  s = transitionRun(s, "sync", {}, 631000);
  const first = s.days[0].blocks[0].id;
  assert.equal(s.run.lastAutoAdvance?.blockId, first);
  const edited = structuredClone(s);
  edited.days[0].blocks[0].duration = 11;
  const resumed = reconcileAutomaticExtension(s, edited, 631000);
  assert.equal(resumed.run.blockId, first);
  assert.equal(timerView(resumed, 631000).elapsedSeconds, 630);
  assert.equal(timerView(resumed, 631000).remainingSeconds, 30);
  assert.equal(
    timerView(resumed, 631000).deltaSeconds,
    60,
    "the extra minute already shows in the projected end",
  );
  assert.equal(resumed.run.plannedDurations?.[first], 600);
  assert.equal(resumed.run.actualDurations?.[first], 0);
  assert.equal(resumed.run.lastAutoAdvance, undefined);
  assert.equal(resumed.run.revision, s.run.revision + 1);
  const advanced = transitionRun(resumed, "sync", {}, 661000);
  assert.equal(advanced.run.actualDurations?.[first], 660);
  assert.equal(timerView(advanced, 661000).deltaSeconds, 60);
  assert.equal(sessionInputSchema.safeParse(advanced).success, true);
  assert.equal("lastAutoAdvance" in publicProjection(advanced).run, false);
});
test("a smaller extension shifts the current block and can subsequently rewind without double counting", () => {
  let s = transitionRun(
    transitionRun(plan(), "start", { autoAdvance: true }, 1000),
    "sync",
    {},
    751000,
  );
  const first = s.days[0].blocks[0].id;
  s = transitionRun(s, "extend", { blockId: first, seconds: 60 }, 751000);
  assert.equal(s.run.blockId, s.days[0].blocks[1].id);
  assert.equal(timerView(s, 751000).elapsedSeconds, 90);
  assert.equal(s.run.actualDurations?.[first], 660);
  s = transitionRun(s, "extend", { blockId: first, seconds: 120 }, 751000);
  assert.equal(s.run.blockId, first);
  assert.equal(timerView(s, 751000).elapsedSeconds, 750);
  assert.equal(timerView(s, 751000).remainingSeconds, 30);
  const finished = transitionRun(s, "stop", {}, 761000);
  assert.equal(finished.run.actualDurations?.[first], 760);
});
test("pause is preserved on automatic recovery and manual navigation invalidates recovery", () => {
  const s = transitionRun(
    transitionRun(plan(), "start", { autoAdvance: true }, 1000),
    "sync",
    {},
    631000,
  );
  const paused = transitionRun(s, "pause", {}, 641000),
    first = s.days[0].blocks[0].id;
  const resumed = transitionRun(
    paused,
    "extend",
    { blockId: first, seconds: 60 },
    841000,
  );
  assert.equal(resumed.run.status, "paused");
  assert.equal(timerView(resumed, 841000).elapsedSeconds, 640);
  assert.equal(timerView(resumed, 999000).remainingSeconds, 20);
  const manual = transitionRun(s, "previous", {}, 641000);
  assert.equal(manual.run.lastAutoAdvance, undefined);
  const next = transitionRun(manual, "next", {}, 651000);
  assert.throws(() =>
    transitionRun(next, "extend", { blockId: first, seconds: 60 }, 651000),
  );
  const draft = structuredClone(next);
  draft.days[0].blocks[0].duration = 12;
  assert.equal(reconcileAutomaticExtension(next, draft, 651000), draft);
});
test("automatic finish can recover the last block; explicit finish and another timer revision cannot", () => {
  let s = transitionRun(
    transitionRun(plan(), "start", { autoAdvance: true }, 1000),
    "sync",
    {},
    921000,
  );
  const last = s.days[0].blocks[1].id;
  assert.equal(s.run.status, "finished");
  s = transitionRun(s, "extend", { blockId: last, seconds: 60 }, 921000);
  assert.equal(s.run.status, "running");
  assert.equal(s.run.blockId, last);
  assert.equal(timerView(s, 921000).remainingSeconds, 40);
  const stopped = transitionRun(s, "stop", {}, 931000);
  assert.equal(stopped.run.lastAutoAdvance, undefined);
  const newer = structuredClone(s);
  newer.days[0].blocks[0].duration = 12;
  newer.run.revision++;
  assert.equal(reconcileAutomaticExtension(s, newer, 941000), newer);
});
test("agenda PUT and facilitator timer action recover the previous automatic block with CAS protection", async (t) => {
  const h = await harness(t);
  await h.setup();
  let s = await h.session();
  s.days[0].blocks = plan().days[0].blocks;
  s = (
    await h.owner.request(`/sessions/${s.id}`, "PUT", {
      version: s.version,
      session: s,
    })
  ).body.session;
  const now = Date.now();
  s = transitionRun(
    transitionRun(s, "start", { autoAdvance: true }, now - 630000),
    "sync",
    {},
    now,
  );
  await h.db.run("UPDATE sessions SET payload=$1 WHERE id=$2", [
    JSON.stringify(s),
    s.id,
  ]);
  const edited = structuredClone(s);
  edited.days[0].blocks[0].duration = 12;
  const saved = await h.owner.request(`/sessions/${s.id}`, "PUT", {
    version: s.version,
    session: edited,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.session.run.blockId, s.days[0].blocks[0].id);
  assert.ok(timerView(saved.body.session).remainingSeconds > 85);
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}/run`, "POST", {
        action: "extend",
        seconds: 60,
        revision: s.run.revision,
      })
    ).status,
    409,
  );
  const facilitator = await h.account("facilitator-recovery@example.test");
  await h.owner.request(`/sessions/${s.id}/members`, "POST", {
    email: facilitator.user.email,
    role: "facilitator",
  });
  s = transitionRun(
    transitionRun(
      saved.body.session,
      "start",
      { autoAdvance: true },
      Date.now() - 750000,
    ),
    "sync",
  );
  await h.db.run("UPDATE sessions SET payload=$1 WHERE id=$2", [
    JSON.stringify(s),
    s.id,
  ]);
  const extended = await facilitator.client.request(
    `/sessions/${s.id}/run`,
    "POST",
    {
      action: "extend",
      blockId: s.days[0].blocks[0].id,
      seconds: 60,
      revision: s.run.revision,
    },
  );
  assert.equal(extended.status, 200, JSON.stringify(extended.body));
  assert.equal(extended.body.session.run.blockId, s.days[0].blocks[0].id);
});
