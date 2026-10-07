import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";
import { createSession, newBlock } from "../shared/domain.js";
import { canCloseSession, sessionNeedsClosing } from "../shared/lifecycle.js";
import type { Role, Session } from "../shared/model.js";

const at = (iso: string) => new Date(iso);
// Prepared a week ahead for 2026-10-01 in Europe/Zurich, with activities.
const workshop = (): Session => {
  const session = createSession(
    "o",
    "W",
    "fr",
    true,
    at("2026-09-24T08:00:00Z"),
  );
  return { ...session, days: [{ ...session.days[0], date: "2026-10-01" }] };
};
const finishedOn = (session: Session, dayId: string): Session => ({
  ...session,
  run: { ...session.run, status: "finished", dayId },
});

test("a session needs closing once its last day is past in its own timezone", () => {
  const s = workshop(),
    nextDay = at("2026-10-02T08:00:00Z");
  for (const role of ["owner", "editor"] as Role[])
    assert.equal(sessionNeedsClosing(s, role, nextDay), true, role);
  for (const role of ["facilitator", "viewer"] as Role[])
    assert.equal(sessionNeedsClosing(s, role, nextDay), false, role);
  // The same evening, with an idle timer, it may not have taken place.
  assert.equal(
    sessionNeedsClosing(s, "owner", at("2026-10-01T20:00:00Z")),
    false,
  );
  // The latest date counts, not the order of the days.
  const later = {
    ...s,
    days: [{ ...s.days[0], id: "later", date: "2026-10-09" }, ...s.days],
  };
  assert.equal(
    sessionNeedsClosing(later, "owner", at("2026-10-05T08:00:00Z")),
    false,
  );
  // 22:30 UTC is already the next day in Geneva, still that day in New York.
  const lastDay = { ...s, days: [{ ...s.days[0], date: "2026-10-07" }] },
    lateEvening = at("2026-10-07T22:30:00Z");
  assert.equal(sessionNeedsClosing(lastDay, "owner", lateEvening), true);
  assert.equal(
    sessionNeedsClosing(
      { ...lastDay, timezone: "America/New_York" },
      "owner",
      lateEvening,
    ),
    false,
  );
  assert.equal(
    sessionNeedsClosing({ ...s, timezone: "Not/AZone" }, "owner", nextDay),
    true,
  );
});

test("the timer finishing the last day flags it the same day, but not a rehearsal or an earlier day", () => {
  const s = workshop(),
    twoDays = {
      ...s,
      days: [
        { ...s.days[0], date: "2026-10-07" },
        { ...s.days[0], id: "second", date: "2026-10-08" },
      ],
    },
    now = at("2026-10-08T10:00:00Z");
  assert.equal(
    sessionNeedsClosing(finishedOn(twoDays, "second"), "owner", now),
    true,
  );
  assert.equal(
    sessionNeedsClosing(finishedOn(twoDays, s.days[0].id), "owner", now),
    false,
  );
  const rehearsal = { ...s, days: [{ ...s.days[0], date: "2026-10-20" }] };
  assert.equal(
    sessionNeedsClosing(finishedOn(rehearsal, s.days[0].id), "owner", now),
    false,
  );
  for (const status of ["running", "paused"] as const)
    assert.equal(
      sessionNeedsClosing(
        { ...s, run: { ...s.run, status } },
        "owner",
        at("2026-10-02T08:00:00Z"),
      ),
      false,
      status,
    );
});

test("a copy that kept past dates is not flagged until its timer finishes", () => {
  const s = workshop(),
    copy = {
      ...s,
      createdAt: "2026-10-07T08:00:00.000Z",
      days: [{ ...s.days[0], date: "2026-09-15" }],
    },
    now = at("2026-10-08T08:00:00Z");
  assert.equal(sessionNeedsClosing(copy, "owner", now), false);
  assert.equal(
    sessionNeedsClosing(finishedOn(copy, s.days[0].id), "owner", now),
    true,
  );
  assert.equal(
    sessionNeedsClosing({ ...copy, createdAt: "" }, "owner", now),
    true,
  );
});

test("a session still on its creation date is flagged only once its timer finishes", () => {
  // New sessions are dated on their creation day, so that date may never
  // have been set: it does not say that the session took place.
  const s = createSession("o", "W", "fr", true, at("2026-10-01T08:00:00Z")),
    later = at("2026-10-20T08:00:00Z");
  assert.equal(s.days[0].date, "2026-10-01");
  assert.equal(sessionNeedsClosing(s, "owner", later), false);
  assert.equal(
    sessionNeedsClosing(finishedOn(s, s.days[0].id), "owner", later),
    true,
  );
  const dated = { ...s, days: [{ ...s.days[0], date: "2026-10-02" }] };
  assert.equal(sessionNeedsClosing(dated, "owner", later), true);
});

test("a session created in the evening west of Zurich is not flagged while still on its creation date", () => {
  // 19:00 in New York is already the next day in Zurich, where new sessions
  // are dated: their date is a day after their creation in New York.
  const zurich = createSession(
      "o",
      "W",
      "en",
      true,
      at("2026-10-01T23:00:00Z"),
    ),
    newYork = { ...zurich, timezone: "America/New_York" };
  assert.equal(zurich.days[0].date, "2026-10-02");
  for (const now of ["2026-10-03T16:00:00Z", "2026-10-04T16:00:00Z"]) {
    assert.equal(sessionNeedsClosing(newYork, "owner", at(now)), false, now);
    assert.equal(sessionNeedsClosing(zurich, "owner", at(now)), false, now);
  }
  // Dated after its creation in both calendars, it is flagged once past.
  const dated = {
    ...newYork,
    days: [{ ...newYork.days[0], date: "2026-10-03" }],
  };
  assert.equal(
    sessionNeedsClosing(dated, "owner", at("2026-10-04T16:00:00Z")),
    true,
  );
});

test("checking a long session list reuses one date format per timezone", (t) => {
  const s = workshop(),
    now = at("2026-10-05T08:00:00Z"),
    { DateTimeFormat } = Intl;
  let built = 0;
  t.mock.method(
    Intl,
    "DateTimeFormat",
    function (...args: ConstructorParameters<typeof DateTimeFormat>) {
      built++;
      return new DateTimeFormat(...args);
    },
  );
  for (let row = 0; row < 100; row++)
    assert.equal(sessionNeedsClosing(s, "owner", now), true);
  assert.ok(built <= 1, `${built} date formats built for 100 rows`);
});

test("closed, archived and activity-less sessions are never flagged", () => {
  const s = workshop(),
    now = at("2026-10-05T08:00:00Z");
  assert.equal(sessionNeedsClosing(s, "owner", now), true);
  for (const session of [
    {
      ...s,
      lifecycle: { closedAt: "2026-10-02T08:00:00Z", facilitatorIds: ["o"] },
    },
    { ...s, archived: true },
    { ...s, days: [{ ...s.days[0], blocks: [] }] },
    {
      ...s,
      days: [{ ...s.days[0], blocks: [newBlock("fr", { kind: "note" })] }],
    },
  ])
    assert.equal(sessionNeedsClosing(session, "owner", now), false);
  assert.deepEqual(
    (["owner", "editor", "facilitator", "viewer"] as Role[]).map(
      canCloseSession,
    ),
    [true, true, false, false],
  );
});

test("the session list flags a finished session for those who may close it, until it is closed", async (t) => {
  const h = await harness(t);
  await h.setup();
  const editor = await h.account("editor@example.test"),
    viewer = await h.account("viewer@example.test");
  let s = await h.session();
  for (const [person, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ] as const)
    await h.db.run(
      "INSERT INTO members(session_id,user_id,role) VALUES($1,$2,$3)",
      [s.id, person.user.id, role],
    );
  type Client = typeof h.owner;
  const listed = async (client: Client) =>
    (await client.request("/sessions")).body.sessions.find(
      (item: { id: string }) => item.id === s.id,
    );
  const run = async (body: Record<string, unknown>) => {
    const response = await h.owner.request(`/sessions/${s.id}/run`, "POST", {
      revision: s.run.revision,
      ...body,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    s = response.body.session;
  };
  // Dated today and not run yet: it may still take place.
  assert.equal((await listed(h.owner)).needsClosing, false);
  await run({ action: "start", dayId: s.days[0].id });
  assert.equal((await listed(h.owner)).needsClosing, false);
  await run({ action: "stop" });
  assert.equal((await listed(h.owner)).needsClosing, true);
  assert.equal((await listed(editor.client)).needsClosing, true);
  assert.equal((await listed(viewer.client)).needsClosing, false);
  const closed = await h.owner.request(`/sessions/${s.id}/lifecycle`, "POST", {
    action: "close",
    version: s.version,
  });
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  const summary = await listed(h.owner);
  assert.equal(summary.needsClosing, false);
  assert.ok(summary.closedAt);
});

test("a copy of a delivered session is not flagged on the dashboard", async (t) => {
  const h = await harness(t);
  await h.setup();
  const s = await h.session();
  const past = await h.owner.request(`/sessions/${s.id}`, "PUT", {
    version: s.version,
    session: { ...s, days: [{ ...s.days[0], date: "2020-01-15" }] },
  });
  assert.equal(past.status, 200, JSON.stringify(past.body));
  // Prepared before its date, like a real workshop.
  const [row] = await h.db.all<{ payload: string }>(
    "SELECT payload FROM sessions WHERE id=$1",
    [s.id],
  );
  await h.db.run("UPDATE sessions SET payload=$1 WHERE id=$2", [
    JSON.stringify({
      ...JSON.parse(row.payload),
      createdAt: "2020-01-01T08:00:00.000Z",
    }),
    s.id,
  ]);
  // The copy keeps the past date but is created now: it has not taken place.
  const copy = await h.owner.request(`/sessions/${s.id}/duplicate`, "POST", {});
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  assert.equal(copy.body.session.days[0].date, "2020-01-15");
  const listed = (await h.owner.request("/sessions")).body.sessions;
  const flag = (id: string) =>
    listed.find((item: { id: string }) => item.id === id).needsClosing;
  assert.equal(flag(s.id), true);
  assert.equal(flag(copy.body.session.id), false);
});
