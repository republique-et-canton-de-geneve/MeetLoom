import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";
import { newBlock, withStepDurations } from "../shared/domain.js";
import type { RunRecord as Run } from "../shared/history.js";

test("every finished run is kept with its planned and actual durations, so the initial plan survives", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  session.days[0].blocks = [
    newBlock("fr", { title: "Accueil", duration: 10 }),
    newBlock("fr", { title: "Atelier", duration: 30 }),
  ];
  session = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session,
      version: session.version,
    })
  ).body.session;
  const run = async (action: string, extra = {}) => {
    const result = await h.owner.request(
      `/sessions/${session.id}/run`,
      "POST",
      { action, ...extra },
    );
    assert.equal(result.status, 200, JSON.stringify(result.body));
    session = result.body.session;
  };
  await run("start");
  await run("next");
  await run("finish");
  const first = (await h.owner.request(`/sessions/${session.id}/runs`)).body
    .runs as Run[];
  assert.equal(first.length, 1);
  assert.equal(first[0].dayTitle, session.days[0].title);
  assert.deepEqual(
    first[0].blocks.map((block) => [block.title, block.planned]),
    [
      ["Accueil", 600],
      ["Atelier", 1800],
    ],
  );
  assert.ok(first[0].blocks.every((block) => block.actual >= 0));

  // Applying the actual durations changes the agenda, not the record.
  await run("apply-actual");
  assert.notEqual(session.days[0].blocks[1].duration, 30);
  await run("reset");
  await run("start");
  await run("finish");
  const runs = (await h.owner.request(`/sessions/${session.id}/runs`)).body
    .runs as Run[];
  assert.equal(runs.length, 2);
  // Oldest first: the first run still holds the initial plan.
  assert.deepEqual(
    runs[0].blocks.map((block) => block.planned),
    [600, 1800],
  );
  assert.notDeepEqual(
    runs[1].blocks.map((block) => block.planned),
    [600, 1800],
  );
  // The initial plan can be put back into the agenda at any time.
  assert.deepEqual(
    withStepDurations(
      session.days,
      runs[0].dayId,
      runs[0].plan,
      false,
    )[0].blocks.map((block) => block.duration),
    [10, 30],
  );
  // Collaborators can read them; strangers cannot.
  const stranger = await h.account("stranger@example.test");
  assert.equal(
    (await stranger.client.request(`/sessions/${session.id}/runs`)).status,
    404,
  );
});

test("editing the agenda after a run keeps the finished run and its actual durations", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  session.days[0].blocks = [
    newBlock("fr", { title: "Accueil", duration: 10 }),
    newBlock("fr", { title: "Atelier", duration: 30 }),
  ];
  const put = async () => {
    const result = await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session,
      version: session.version,
    });
    assert.equal(result.status, 200, JSON.stringify(result.body));
    session = result.body.session;
  };
  await put();
  // Moving past the last block finishes the run, like the facilitator does.
  for (const action of ["start", "next", "next"]) {
    const result = await h.owner.request(
      `/sessions/${session.id}/run`,
      "POST",
      { action },
    );
    session = result.body.session;
  }
  assert.equal(session.run.status, "finished");
  session.days[0].blocks[1].title = "Atelier corrigé";
  await put();
  // A typo fix no longer throws away the run: "restore the starting plan"
  // and "use actual durations" stay available.
  assert.equal(session.run.status, "finished");
  assert.ok(session.run.plannedDurations);
  assert.ok(Object.keys(session.run.actualDurations ?? {}).length);
});
