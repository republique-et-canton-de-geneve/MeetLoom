import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";
import { createSession, newBlock, transitionRun } from "../shared/domain.js";
import { forgottenRun, stopForgotten } from "../server/forgotten-runs.js";
import type { RunRecord } from "../shared/history.js";
import {
  replaceWithSnapshot,
  takeSnapshot,
  dialectOf,
} from "../server/snapshot.js";

const HOUR = 60 * 60 * 1000;
/** The first moment at or after `from` whose UTC hour is `hour`. */
const nextUtcHour = (from: number, hour: number, minutes = 0) => {
  const date = new Date(from);
  date.setUTCHours(hour, minutes, 0, 0);
  return date.getTime() >= from ? date.getTime() : date.getTime() + 24 * HOUR;
};

test("only a timer left alone for hours is forgotten, never a session still going", () => {
  let session = createSession("owner", "Atelier", "fr");
  session.timezone = "UTC";
  session.days[0].blocks = [
    newBlock("fr", { title: "A", duration: 10 }),
    newBlock("fr", { title: "B", duration: 30 }),
  ];
  const start = nextUtcHour(Date.now(), 9);
  session = transitionRun(session, "start", {}, start);
  session.updatedAt = new Date(start).toISOString();
  const minutes = (value: number) => start + value * 60 * 1000;
  // The step's 10 minutes, then less than a day of overrun: kept, even
  // overnight.
  assert.equal(forgottenRun(session, minutes(30)), false);
  assert.equal(forgottenRun(session, nextUtcHour(start, 23, 30)), false);
  assert.equal(forgottenRun(session, minutes(10 + 24 * 60 - 1)), false);
  // 24 hours past the step with nothing happening on the session: forgotten.
  assert.equal(forgottenRun(session, minutes(10 + 24 * 60 + 1)), true);
  // Anything happening on the session (an edit, next, an extension) counts
  // as someone still there.
  assert.equal(
    forgottenRun(
      { ...session, updatedAt: new Date(minutes(120)).toISOString() },
      minutes(10 + 24 * 60 + 1),
    ),
    false,
  );
  // Time added to the step moves its end.
  const extended = structuredClone(session);
  extended.days[0].blocks[0].duration = 240;
  assert.equal(forgottenRun(extended, minutes(10 + 24 * 60 + 1)), false);
  // A scheduled start still ahead is waiting, not forgotten.
  const later = createSession("owner", "Plus tard", "fr");
  later.days[0].blocks = [newBlock("fr", { title: "Ouverture", duration: 10 })];
  const waiting = transitionRun(later, "start", {}, minutes(24 * 60));
  waiting.updatedAt = new Date(start).toISOString();
  assert.equal(forgottenRun(waiting, minutes(10 * 60)), false);

  // A paused timer no longer counts: kept for a week without changes, so a
  // session paused overnight or over a weekend resumes where it was.
  const paused = transitionRun(session, "pause", {}, minutes(5));
  paused.updatedAt = new Date(minutes(5)).toISOString();
  assert.equal(forgottenRun(paused, minutes(3 * 24 * 60)), false);
  assert.equal(forgottenRun(paused, minutes(6 * 24 * 60)), false);
  assert.equal(forgottenRun(paused, minutes(8 * 24 * 60)), true);
  // Stopped, a forgotten step counts for its planned time, paused or not.
  const stoppedPaused = stopForgotten(paused, minutes(8 * 24 * 60));
  assert.equal(stoppedPaused.run.status, "finished");
  assert.equal(
    stoppedPaused.run.actualDurations?.[session.days[0].blocks[0].id],
    600,
  );
  // Finished or idle timers are left alone.
  assert.equal(
    forgottenRun(
      transitionRun(session, "stop", {}, minutes(60)),
      minutes(9999),
    ),
    false,
  );
});

test("a forgotten timer is stopped once, keeps a sensible run history and tells its organizers", async (t) => {
  const h = await harness(t);
  await h.setup();
  const facilitator = await h.account("facilitator@example.test"),
    viewer = await h.account("viewer@example.test");
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
  for (const [account, role] of [
    [facilitator, "facilitator"],
    [viewer, "viewer"],
  ] as const)
    await h.owner.request(`/sessions/${session.id}/members`, "POST", {
      email: account.user.email,
      role,
    });
  session = (
    await h.owner.request(`/sessions/${session.id}/run`, "POST", {
      action: "start",
    })
  ).body.session;
  const start = session.run.runStartedAt!;

  // Overnight, the timer is still simply overrunning: kept.
  await h.runs.sweep(start + 12 * HOUR);
  assert.equal(
    (await h.owner.request(`/sessions/${session.id}`)).body.session.run.status,
    "running",
  );
  // Left alone for a day past the step: stopped.
  const late = start + 25 * HOUR;
  await h.runs.sweep(late);
  const stopped = (await h.owner.request(`/sessions/${session.id}`)).body
    .session;
  assert.equal(stopped.run.status, "finished");
  const runs = (await h.owner.request(`/sessions/${session.id}/runs`)).body
    .runs as RunRecord[];
  assert.equal(runs.length, 1);
  assert.equal(runs[0].blocks[0].actual, 600);
  // Organizers see why in their notifications; viewers are not bothered.
  assert.equal(
    (await facilitator.client.request("/notifications?kinds=2")).body
      .notifications[0].kind,
    "run-stopped",
  );
  assert.equal(
    (await viewer.client.request("/notifications?kinds=2")).body.notifications
      .length,
    0,
  );
  // Nothing more on the next sweep.
  await h.runs.sweep(late + 10 * 60 * 1000);
  assert.equal(
    (await h.owner.request("/notifications?kinds=2")).body.notifications.filter(
      (item: { kind: string }) => item.kind === "run-stopped",
    )[0].count ?? 1,
    1,
  );
});

test("restoring data lists the timers it brings back", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  await h.owner.request(`/sessions/${session.id}/run`, "POST", {
    action: "start",
  });
  const snapshot = await takeSnapshot(h.db, {
    version: "test",
    commit: null,
  } as never);
  // Like a restore: the database kind is known before the transaction.
  const dialect = await dialectOf(h.db);
  await h.db.transaction((sql) => replaceWithSnapshot(sql, dialect, snapshot));
  assert.deepEqual(
    (
      await h.db.all<{ session_id: string }>(
        "SELECT session_id FROM active_runs",
      )
    ).map((row) => row.session_id),
    [session.id],
  );
});

test("a timer an older pod started is still found, and a planned run started again is stopped again", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  session.timezone = "UTC";
  session.days[0].date = new Date().toISOString().slice(0, 10);
  session.days[0].startTime = "00:00";
  session.days[0].blocks = [newBlock("fr", { title: "Accueil", duration: 10 })];
  session = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session,
      version: session.version,
    })
  ).body.session;
  const run = async (action: string, startMode?: "planned") => {
    const response = await h.owner.request(
      `/sessions/${session.id}/run`,
      "POST",
      { action, startMode, revision: session.run.revision },
    );
    assert.equal(response.status, 200, JSON.stringify(response.body));
    session = response.body.session;
  };
  const status = async () =>
    (await h.owner.request(`/sessions/${session.id}`)).body.session.run.status;

  await run("start", "planned");
  const planned = session.run.runStartedAt;
  // Saved by a pod that does not list timers yet, during a rolling update.
  await h.db.run("DELETE FROM active_runs");
  await h.runs.sweep(Date.now() + 25 * HOUR);
  assert.equal(await status(), "finished");

  // Reset and started again on the same schedule: a new run, stopped too.
  session = (await h.owner.request(`/sessions/${session.id}`)).body.session;
  await run("reset");
  await run("start", "planned");
  assert.equal(session.run.runStartedAt, planned);
  await h.runs.sweep(Date.now() + 25 * HOUR);
  assert.equal(await status(), "finished");
});

test("an auto-advancing run is judged on the step it has really reached", () => {
  let session = createSession("owner", "Atelier", "fr");
  session.timezone = "UTC";
  session.days[0].blocks = [
    newBlock("fr", { title: "Accueil", duration: 10 }),
    newBlock("fr", { title: "Journée", duration: 24 * 60 }),
    newBlock("fr", { title: "Clôture", duration: 10 }),
  ];
  const start = nextUtcHour(Date.now(), 9);
  session = transitionRun(session, "start", { autoAdvance: true }, start);
  session.updatedAt = new Date(start).toISOString();
  // Nobody polled: the saved step is still the first one, a day behind.
  const closing = start + (10 + 24 * 60 + 1) * 60 * 1000;
  assert.equal(forgottenRun(session, closing), false);
});

test("timers restored by an older pod are found during the rollout", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  session.days[0].blocks = [newBlock("fr", { title: "Accueil", duration: 10 })];
  const saved = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session,
      version: session.version,
    })
  ).body.session;
  await h.owner.request(`/sessions/${saved.id}/run`, "POST", {
    action: "start",
  });
  // An older pod's restore: dates from the archive, and nothing relisted.
  await h.db.run("DELETE FROM active_runs");
  await h.db.run("UPDATE sessions SET updated_at=$1 WHERE id=$2", [
    "2020-01-01T00:00:00.000Z",
    saved.id,
  ]);
  await h.runs.sweep(Date.now() + 25 * HOUR);
  assert.equal(
    (await h.owner.request(`/sessions/${saved.id}`)).body.session.run.status,
    "finished",
  );
});

test("a listed session whose timer no longer runs leaves the list", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  // Stopped by an older pod, which does not unlist it.
  await h.db.run("INSERT INTO active_runs(session_id,since) VALUES($1,$2)", [
    session.id,
    new Date().toISOString(),
  ]);
  await h.runs.sweep();
  assert.deepEqual(await h.db.all("SELECT session_id FROM active_runs"), []);
});

test("an auto-advancing run past its last step is saved as finished and recorded", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  session.days[0].blocks = [newBlock("fr", { title: "Accueil", duration: 1 })];
  const saved = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session,
      version: session.version,
    })
  ).body.session;
  await h.owner.request(`/sessions/${saved.id}/run`, "POST", {
    action: "start",
    autoAdvance: true,
  });
  // Nobody polls; the sweep saves its end like a poll would.
  await h.runs.sweep(Date.now() + 10 * 60 * 1000);
  const [row] = await h.db.all<{ payload: string }>(
    "SELECT payload FROM sessions WHERE id=$1",
    [saved.id],
  );
  assert.equal(JSON.parse(row.payload).run.status, "finished");
  assert.equal(
    (
      (await h.owner.request(`/sessions/${saved.id}/runs`)).body
        .runs as RunRecord[]
    ).length,
    1,
  );
  assert.deepEqual(await h.db.all("SELECT session_id FROM active_runs"), []);
});
