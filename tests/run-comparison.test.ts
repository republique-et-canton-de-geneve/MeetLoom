import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  compareDurations,
  createSession,
  newBlock,
  runComparison,
  transitionRun,
} from "../shared/domain.js";
import type { RunState, Session } from "../shared/model.js";
import type { RunRecord } from "../shared/history.js";
import { durationGapLabel } from "../src/ui.tsx";
import { DurationField, RunCompare, RunContext } from "../src/TimeFields.tsx";
import RunsHistory, { playedSteps } from "../src/RunsHistory.tsx";
import { recordFinishedRun } from "../server/runs.js";

// Seconds are expressed from the run start at t = 0 to keep scenarios readable.
const at = (seconds: number) => 1_000_000 + seconds * 1000;

function plan(...minutes: number[]) {
  const session = createSession("owner", "Comparison", "fr", false);
  session.days[0].blocks = minutes.map((duration, index) =>
    newBlock("fr", { title: `Bloc ${index + 1}`, duration }),
  );
  return session;
}
const blocks = (session: Session) => session.days[0].blocks;
/** The run record the server keeps when `after` finishes the run. */
async function recorded(before: Session, after: Session): Promise<RunRecord> {
  let payload = "";
  await recordFinishedRun(
    {
      all: async <T>() => [] as T[],
      run: async (_sql, values) => {
        payload = String(values?.[3]);
        return 1;
      },
    },
    before,
    after,
  );
  return {
    id: "run-1",
    dayId: after.days[0].id,
    startedAt: "2026-10-07T09:00:00.000Z",
    finishedAt: "2026-10-07T09:30:00.000Z",
    ...(JSON.parse(payload) as Pick<RunRecord, "dayTitle" | "blocks" | "plan">),
  };
}
const history = (run: RunRecord, session: Session) =>
  renderToStaticMarkup(
    createElement(RunsHistory, {
      runs: [run],
      session,
      editable: false,
      apply: () => {},
    }),
  );

test("a played block is compared with the plan captured at the start, whatever its duration becomes", () => {
  let s = plan(10, 10);
  const [a, b] = blocks(s);
  assert.equal(runComparison(s.run, [a]), null, "idle");
  s = transitionRun(s, "start", {}, at(0));
  assert.equal(runComparison(s.run, [a]), null, "not yet played");
  s = transitionRun(s, "next", {}, at(530));
  assert.deepEqual(runComparison(s.run, [a]), {
    plannedMinutes: 10,
    actualMinutes: 8,
    actualSeconds: 530,
    deltaMinutes: -2,
    state: "early",
  });
  assert.equal(runComparison(s.run, blocks(s)), null, "B not played yet");
  s = transitionRun(s, "stop", {}, at(1430));
  assert.deepEqual(runComparison(s.run, [b]), {
    plannedMinutes: 10,
    actualMinutes: 15,
    actualSeconds: 900,
    deltaMinutes: 5,
    state: "very-late",
  });
  const day = runComparison(s.run, blocks(s));
  assert.equal(day?.plannedMinutes, 20);
  assert.equal(day?.actualMinutes, 23);
  assert.equal(day?.deltaMinutes, 3);
  assert.equal(day?.state, "late");
  const applied = transitionRun(s, "apply-actual", {}, at(1500));
  assert.equal(blocks(applied)[0].duration, 8);
  assert.equal(
    runComparison(applied.run, [blocks(applied)[0]])?.plannedMinutes,
    10,
    "the plan captured at the start, not the applied duration",
  );
  const reset = transitionRun(applied, "reset", {}, at(1600));
  assert.equal(runComparison(reset.run, [blocks(reset)[0]]), null);
});

test("extending a block during the run shows as an overrun, not as on schedule", () => {
  let s = transitionRun(plan(10, 10), "start", {}, at(0));
  s = transitionRun(s, "extend", { seconds: 300 }, at(60));
  assert.equal(blocks(s)[0].duration, 15);
  s = transitionRun(s, "next", {}, at(900));
  const comparison = runComparison(s.run, [blocks(s)[0]]);
  assert.equal(comparison?.plannedMinutes, 10);
  assert.equal(comparison?.actualMinutes, 15);
  assert.equal(comparison?.deltaMinutes, 5);
  assert.equal(comparison?.state, "very-late");
});

test("a block the timer goes back to after an automatic advance is not compared while it runs", () => {
  let s = plan(10, 10);
  const [a, b] = blocks(s);
  s = transitionRun(s, "start", { autoAdvance: true }, at(0));
  s = transitionRun(s, "sync", {}, at(605));
  assert.equal(s.run.blockId, b.id);
  assert.equal(runComparison(s.run, [a])?.actualMinutes, 10);
  // "+1 min au précédent" before A's new end: the timer goes back to A, and
  // the run keeps a key for it.
  s = transitionRun(s, "extend", { blockId: a.id, seconds: 60 }, at(610));
  assert.equal(s.run.status, "running");
  assert.equal(s.run.blockId, a.id);
  assert.ok(Object.hasOwn(s.run.actualDurations ?? {}, a.id));
  assert.equal(runComparison(s.run, [a]), null, "A is running again");
  assert.equal(runComparison(s.run, blocks(s)), null, "nor the day");
  s = transitionRun(s, "pause", {}, at(620));
  assert.equal(runComparison(s.run, [a]), null, "paused on A");
  s = transitionRun(s, "resume", {}, at(630));
  s = transitionRun(s, "next", {}, at(690));
  const played = runComparison(s.run, [a]);
  assert.deepEqual(
    [played?.plannedMinutes, played?.actualMinutes, played?.deltaMinutes],
    [10, 11, 1],
  );
  // A single-block day the automatic advance had finished comes back too.
  let single = plan(10);
  single = transitionRun(single, "start", { autoAdvance: true }, at(0));
  single = transitionRun(single, "sync", {}, at(605));
  assert.equal(single.run.status, "finished");
  single = transitionRun(
    single,
    "extend",
    { blockId: blocks(single)[0].id, seconds: 60 },
    at(610),
  );
  assert.equal(single.run.status, "running");
  assert.equal(runComparison(single.run, blocks(single)), null);
});

test("a group and the day compare once every step in them was played; notes never compare", () => {
  let s = createSession("owner", "Groups", "fr", false);
  const children = [5, 10, 15].map((duration, index) =>
    newBlock("fr", { title: `Enfant ${index + 1}`, duration }),
  );
  const group = newBlock("fr", { kind: "group", title: "G", children });
  const note = newBlock("fr", { kind: "note", title: "N", duration: 0 });
  const d = newBlock("fr", { title: "D", duration: 10 });
  s.days[0].blocks = [group, note, d];
  s = transitionRun(s, "start", {}, at(0));
  s = transitionRun(s, "next", {}, at(360));
  s = transitionRun(s, "next", {}, at(960));
  assert.equal(runComparison(s.run, [group]), null);
  assert.equal(runComparison(s.run, blocks(s)), null);
  const first = runComparison(s.run, [children[0]]);
  assert.deepEqual(
    [first?.plannedMinutes, first?.actualMinutes, first?.deltaMinutes],
    [5, 6, 1],
  );
  assert.equal(first?.state, "late");
  // Added during the run: not in the plan captured at the start.
  const e = newBlock("fr", { title: "E", duration: 5 });
  s = { ...s, days: [{ ...s.days[0], blocks: [...blocks(s), e] }] };
  s = transitionRun(s, "next", {}, at(1860));
  const grouped = runComparison(s.run, [group]);
  assert.deepEqual(
    [grouped?.plannedMinutes, grouped?.actualMinutes, grouped?.deltaMinutes],
    [30, 31, 1],
  );
  assert.equal(grouped?.state, "late");
  s = transitionRun(s, "next", {}, at(2460));
  assert.equal(runComparison(s.run, blocks(s)), null, "E not played yet");
  s = transitionRun(s, "next", {}, at(2700));
  assert.equal(s.run.status, "finished");
  const added = runComparison(s.run, [e]);
  assert.deepEqual(
    [added?.plannedMinutes, added?.actualMinutes, added?.deltaMinutes],
    [5, 4, -1],
  );
  assert.equal(added?.state, "early");
  const day = runComparison(s.run, blocks(s));
  assert.deepEqual(
    [day?.plannedMinutes, day?.actualMinutes, day?.deltaMinutes],
    [45, 45, 0],
  );
  assert.equal(day?.state, "on-time");
  assert.equal(runComparison(s.run, [note]), null);
  const otherDay = newBlock("fr", { title: "Autre jour", duration: 10 });
  assert.equal(runComparison(s.run, [otherDay]), null);
});

test("the gap is the difference of the whole minutes shown", () => {
  const cases: [number, number, number, string][] = [
    [599, 9, -1, "early"],
    [659, 10, 0, "on-time"],
    [840, 14, 4, "late"],
    [900, 15, 5, "very-late"],
    [30, 0, -10, "early"],
  ];
  for (const [actual, minutes, delta, state] of cases) {
    const comparison = compareDurations(600, actual);
    assert.equal(comparison.plannedMinutes, 10);
    assert.equal(comparison.actualMinutes, minutes, `${actual} s`);
    assert.equal(comparison.deltaMinutes, delta, `${actual} s`);
    assert.equal(comparison.state, state, `${actual} s`);
  }
});

test("gap labels are signed whole minutes", () => {
  assert.equal(durationGapLabel(0), "=");
  assert.equal(durationGapLabel(3), "+3 min");
  assert.equal(durationGapLabel(-2), "−2 min");
  assert.equal(durationGapLabel(75), "+1 h 15 min");
});

test("a played block shows its actual time, the gap and the plan together", () => {
  const block = newBlock("fr", { id: "A", title: "A", duration: 12 });
  const field = createElement(DurationField, {
    value: 12,
    label: "Durée de A",
    change: () => {},
    block,
  });
  const run = (status: RunState["status"], blockId: string | null = null) => ({
    status,
    blockId,
    plannedDurations: { A: 600 },
    actualDurations: { A: 530 },
  });
  const html = renderToStaticMarkup(
    createElement(RunContext.Provider, { value: run("finished") }, field),
  );
  assert.match(
    html,
    /<button[^>]*class="actual-duration"[^>]*>8 min<\/button>/,
  );
  assert.match(
    html,
    /<span class="duration-gap" data-gap="early"[^>]*aria-hidden="true"[^>]*>−2 min<\/span>/,
  );
  assert.match(html, /prévu 10\u00a0min/);
  assert.match(
    html,
    /aria-label="Durée de A · Durée réelle : 8 min 50 s · prévue : 10 min · 2 min d’avance · durée dans l’agenda : 12 min"/,
  );
  assert.doesNotMatch(html, /<input/);
  for (const idle of [
    renderToStaticMarkup(
      createElement(RunContext.Provider, { value: run("idle") }, field),
    ),
    renderToStaticMarkup(field),
    // The timer went back to A: it is running, not played.
    renderToStaticMarkup(
      createElement(RunContext.Provider, { value: run("running", "A") }, field),
    ),
  ]) {
    assert.match(idle, /<input[^>]*value="12"/);
    assert.doesNotMatch(idle, /duration-compare/);
  }
});

test("the time cell, its sentence and the run record use the same whole seconds", async () => {
  const block = newBlock("fr", { id: "A", title: "A", duration: 10 });
  const cell = (actual: number) =>
    renderToStaticMarkup(
      createElement(
        RunContext.Provider,
        {
          value: {
            status: "finished",
            blockId: null,
            plannedDurations: { A: 600 },
            actualDurations: { A: actual },
          },
        },
        createElement(DurationField, {
          value: 10,
          label: "Durée de A",
          change: () => {},
          block,
        }),
      ),
    );
  // Half a second short of ten minutes is still nine whole minutes.
  const short = cell(599.6);
  assert.match(short, />9 min<\/button>/);
  assert.match(short, />−1 min<\/span>/);
  assert.match(
    short,
    /aria-label="Durée de A · Durée réelle : 9 min 59 s · prévue : 10 min · 1 min d’avance"/,
  );
  // Floating-point noise from adding up timer stints is not a minute early.
  const noisy = cell(600 - 1e-12);
  assert.match(noisy, />10 min<\/button>/);
  assert.match(noisy, />=<\/span>/);
  assert.match(noisy, /Durée réelle : 10 min 0 s/);

  // Versions & activity › Runs keeps the same whole seconds.
  const s = transitionRun(plan(10), "start", {}, at(0));
  const finished = transitionRun(s, "stop", {}, at(599.6));
  const [step] = (await recorded(s, finished)).blocks;
  assert.equal(step.actual, 599);
  assert.equal(
    compareDurations(step.planned, step.actual).deltaMinutes,
    runComparison(finished.run, blocks(finished))?.deltaMinutes,
  );
});

test("group and day totals read planned, actual and gap", () => {
  const html = renderToStaticMarkup(
    createElement(RunCompare, { comparison: compareDurations(1800, 1860) }),
  );
  assert.match(html, /Prévu 30 min ·/);
  assert.match(html, /réel/);
  assert.match(html, /31 min/);
  assert.match(
    html,
    /<span class="duration-gap" data-gap="late"[^>]*>\+1 min<\/span>/,
  );
  assert.match(html, /title="Prévu au lancement du minuteur : 30 min[^"]*"/);
  assert.match(html, /title="[^"]*1 min de retard"/);
  assert.doesNotMatch(html, /<strong/);
});

test("past runs show the same gap as the agenda", () => {
  const session = createSession("owner", "History", "fr", false);
  const run: RunRecord = {
    id: "run-1",
    dayId: session.days[0].id,
    dayTitle: session.days[0].title,
    startedAt: "2026-10-07T09:00:00.000Z",
    finishedAt: "2026-10-07T09:09:00.000Z",
    blocks: [{ id: "A", title: "Accueil", planned: 600, actual: 530 }],
    plan: { A: 600 },
  };
  const html = history(run, session);
  assert.match(html, /<td>−2 min<\/td>/);
  assert.match(html, /2 min d’avance/);
});

test("past runs count every step the run reached, in the agenda's whole seconds", async () => {
  // A step left after 0.6 s was played: the agenda counts it, so do past runs.
  let s = transitionRun(plan(10, 10, 10), "start", {}, at(0));
  s = transitionRun(s, "next", {}, at(600));
  s = transitionRun(s, "next", {}, at(600.6));
  const skipped = transitionRun(s, "stop", {}, at(1200.6));
  const day = runComparison(skipped.run, blocks(skipped));
  assert.equal(day?.deltaMinutes, -10);
  const run = await recorded(s, skipped);
  assert.deepEqual(
    playedSteps(run).map((step) => step.title),
    ["Bloc 1", "Bloc 2", "Bloc 3"],
    "what “Apply these actual durations” puts back",
  );
  const html = history(run, skipped);
  assert.match(
    html,
    /<span class="history-run-gap" data-gap="early">10 min d’avance<\/span>/,
  );
  assert.match(
    html,
    /<td>Bloc 2<\/td><td>10 min<\/td><td>0 min<\/td><td>−10 min<\/td>/,
  );
  // Records kept before steps were marked keep their reading.
  const legacy = {
    ...run,
    blocks: run.blocks.map(({ id, title, planned, actual }) => ({
      id,
      title,
      planned,
      actual,
    })),
  };
  assert.deepEqual(
    playedSteps(legacy).map((step) => step.title),
    ["Bloc 1", "Bloc 3"],
  );

  // Two steps of 300.6 s and 299.6 s: 300 + 299 whole seconds, nine minutes,
  // in the agenda's day, section and group totals as in past runs.
  let t = transitionRun(plan(5, 5), "start", {}, at(0));
  t = transitionRun(t, "next", {}, at(300.6));
  const finished = transitionRun(t, "stop", {}, at(600.2));
  const total = runComparison(finished.run, blocks(finished));
  assert.deepEqual(
    [total?.actualMinutes, total?.actualSeconds, total?.deltaMinutes],
    [9, 599, -1],
  );
  assert.match(
    history(await recorded(t, finished), finished),
    /réel 9 min<span class="history-run-gap" data-gap="early">1 min d’avance<\/span>/,
  );
});

test("past runs word and colour their gap like the agenda, very late included", () => {
  const session = createSession("owner", "History", "fr", false);
  const run: RunRecord = {
    id: "run-1",
    dayId: session.days[0].id,
    dayTitle: session.days[0].title,
    startedAt: "2026-10-07T09:00:00.000Z",
    finishedAt: "2026-10-07T12:15:00.000Z",
    blocks: [
      {
        id: "A",
        title: "Atelier",
        planned: 7200,
        actual: 11_700,
        played: true,
      },
    ],
    plan: { A: 7200 },
  };
  const gap = compareDurations(7200, 11_700);
  assert.equal(gap.state, "very-late");
  const agenda = renderToStaticMarkup(
    createElement(RunCompare, { comparison: gap }),
  );
  assert.match(agenda, /title="[^"]*1 h 15 min de retard"/);
  assert.match(
    history(run, session),
    /<span class="history-run-gap" data-gap="very-late">1 h 15 min de retard<\/span>/,
  );
});
