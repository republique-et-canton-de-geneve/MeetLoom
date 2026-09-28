import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";
import { createSession, newBlock, transitionRun } from "../shared/domain.js";
import { forgottenRun, stopForgotten } from "../server/forgotten-runs.js";
import type { MailMessage } from "../server/mailer.js";
import type { RunRecord } from "../shared/history.js";

const HOUR = 60 * 60 * 1000;
/** The first moment at or after `from` whose UTC hour is `hour`. */
const nextUtcHour = (from: number, hour: number, minutes = 0) => {
  const date = new Date(from);
  date.setUTCHours(hour, minutes, 0, 0);
  return date.getTime() >= from ? date.getTime() : date.getTime() + 24 * HOUR;
};

test("a timer left running is recalled after an hour and stopped at night", () => {
  let session = createSession("owner", "Atelier", "fr");
  session.timezone = "UTC";
  session.days[0].blocks = [
    newBlock("fr", { title: "A", duration: 10 }),
    newBlock("fr", { title: "B", duration: 30 }),
  ];
  const start = nextUtcHour(Date.now(), 9);
  session = transitionRun(session, "start", {}, start);
  // Within the plan, or less than an hour past it: nothing.
  assert.equal(forgottenRun(session, start + 30 * 60 * 1000), null);
  assert.equal(forgottenRun(session, start + 90 * 60 * 1000), null);
  // An hour past the 40 planned minutes, during the day: a reminder.
  assert.equal(forgottenRun(session, start + 101 * 60 * 1000), "remind");
  // Still going at night: stopped.
  assert.equal(forgottenRun(session, nextUtcHour(start, 23, 30)), "stop");
  assert.equal(forgottenRun(session, nextUtcHour(start, 3)), "stop");
  // A paused timer is forgotten just the same.
  const paused = transitionRun(session, "pause", {}, start + 5 * 60 * 1000);
  assert.equal(forgottenRun(paused, nextUtcHour(start, 23, 30)), "stop");
  // An evening session still within its plan runs on.
  let evening = createSession("owner", "Soirée", "fr");
  evening.timezone = "UTC";
  evening.days[0].blocks = [newBlock("fr", { title: "Long", duration: 240 })];
  evening = transitionRun(evening, "start", {}, nextUtcHour(start, 21));
  assert.equal(forgottenRun(evening, nextUtcHour(start, 23, 30)), null);
  // Stopped, a forgotten step counts for its planned time, paused or not.
  const stoppedPaused = stopForgotten(paused, nextUtcHour(start, 23, 30));
  assert.equal(stoppedPaused.run.status, "finished");
  assert.equal(
    stoppedPaused.run.actualDurations?.[session.days[0].blocks[0].id],
    600,
  );
  // Time added during the run moves the end: an evening session extended
  // until one in the morning is not stopped at half past eleven.
  let extended = createSession("owner", "Prolongée", "fr");
  extended.timezone = "UTC";
  extended.days[0].blocks = [newBlock("fr", { title: "Débat", duration: 60 })];
  extended = transitionRun(extended, "start", {}, nextUtcHour(start, 21));
  extended.days[0].blocks[0].duration = 240;
  assert.equal(forgottenRun(extended, nextUtcHour(start, 23, 30)), null);
  // Finished or idle timers are left alone.
  assert.equal(
    forgottenRun(
      transitionRun(session, "stop", {}, start + HOUR),
      start + 20 * HOUR,
    ),
    null,
  );
});

test("forgotten timers: one reminder to the organizers, then a stop that keeps the run history sensible", async (t) => {
  const messages: MailMessage[] = [],
    h = await harness(t, {
      mail: {
        host: "smtp.example.test",
        port: 587,
        secure: false,
        from: "meetloom@example.test",
        scheduled: false,
      },
      mailTransport: {
        async send(message) {
          messages.push(message);
        },
      },
    });
  await h.setup();
  const facilitator = await h.account("facilitator@example.test"),
    viewer = await h.account("viewer@example.test");
  let session = await h.session();
  session.timezone = "UTC";
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
  await h.mail.flush();
  messages.length = 0;

  // Two hours later, during the day: one reminder, not repeated.
  const day =
    new Date(start + 2 * HOUR).getUTCHours() >= 5 &&
    new Date(start + 2 * HOUR).getUTCHours() < 23
      ? start + 2 * HOUR
      : nextUtcHour(start + 2 * HOUR, 9);
  await h.runs.sweep(day);
  await h.runs.sweep(day + 10 * 60 * 1000);
  await h.mail.deliverQueued(day);
  assert.deepEqual(messages.map((message) => message.to).sort(), [
    "facilitator@example.test",
    "owner@example.test",
  ]);
  assert.match(messages[0].text, new RegExp(`/session/${session.id}`));
  const bell = (await facilitator.client.request("/notifications")).body;
  assert.equal(bell.notifications[0].kind, "run-overdue");
  assert.equal(
    (await viewer.client.request("/notifications")).body.notifications.length,
    0,
  );
  assert.equal(
    (await h.owner.request(`/sessions/${session.id}`)).body.session.run.status,
    "running",
  );

  // Still running at night: stopped, the current block credited with its
  // planned time rather than the whole night.
  messages.length = 0;
  const night = nextUtcHour(day, 23, 30);
  await h.runs.sweep(night);
  await h.mail.deliverQueued(night);
  const stopped = (await h.owner.request(`/sessions/${session.id}`)).body
    .session;
  assert.equal(stopped.run.status, "finished");
  const runs = (await h.owner.request(`/sessions/${session.id}/runs`)).body
    .runs as RunRecord[];
  assert.equal(runs.length, 1);
  assert.equal(runs[0].blocks[0].actual, 600);
  assert.equal(messages.length, 2);
  assert.match(messages[0].subject, /arrêté|stopped/);
  assert.equal(
    (await h.owner.request("/notifications")).body.notifications[0].kind,
    "run-stopped",
  );
  // Nothing more to do on the next sweep.
  await h.runs.sweep(night + 10 * 60 * 1000);
  await h.mail.deliverQueued(night + 10 * 60 * 1000);
  assert.equal(messages.length, 2);
});
