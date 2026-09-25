import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";
import { newForm, newQuestion } from "../shared/content.js";
import { newBlock } from "../shared/domain.js";

test("closing a session freezes agenda, timer, comments and form access, while preserving readable shares", async (t) => {
  const h = await harness(t),
    owner = await h.setup(),
    editor = await h.account("editor@example.test"),
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
  const share = (
    await h.owner.request(`/sessions/${s.id}/shares`, "POST", {
      label: "Public",
    })
  ).body.share;
  assert.equal(
    (
      await viewer.client.request(`/sessions/${s.id}/lifecycle`, "POST", {
        action: "close",
        version: s.version,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}/lifecycle`, "POST", {
        action: "close",
        version: s.version,
        facilitatorIds: ["not-member"],
      })
    ).status,
    400,
  );
  const closed = await editor.client.request(
    `/sessions/${s.id}/lifecycle`,
    "POST",
    {
      action: "close",
      version: s.version,
      facilitatorIds: [owner.id, editor.user.id],
    },
  );
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  s = closed.body.session;
  assert.ok(s.lifecycle.closedAt);
  assert.equal((await viewer.client.request(`/sessions/${s.id}`)).status, 200);
  assert.equal(
    (await h.client().request(`/public/${share.token}`)).status,
    200,
  );
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}`, "PUT", {
        version: s.version,
        session: { ...s, title: "Forbidden", lifecycle: undefined },
      })
    ).body.code,
    "SESSION_CLOSED",
  );
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}/run`, "POST", {
        action: "start",
        revision: s.run.revision,
        dayId: s.days[0].id,
      })
    ).body.code,
    "SESSION_CLOSED",
  );
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}/comments`, "POST", {
        text: "Frozen",
        blockId: null,
      })
    ).body.code,
    "SESSION_CLOSED",
  );
  assert.equal(
    (
      await editor.client.request(`/sessions/${s.id}/lifecycle`, "POST", {
        action: "reopen",
        version: s.version,
      })
    ).status,
    403,
  );
  const duplicate = await viewer.client.request(
    `/sessions/${s.id}/duplicate`,
    "POST",
    {},
  );
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.session.lifecycle, undefined);
  assert.equal(
    (
      await viewer.client.request(
        `/sessions/${duplicate.body.session.id}`,
        "PUT",
        {
          version: duplicate.body.session.version,
          session: { ...duplicate.body.session, title: "Editable copy" },
        },
      )
    ).status,
    200,
  );
  const reopened = await h.owner.request(
    `/sessions/${s.id}/lifecycle`,
    "POST",
    { action: "reopen", version: s.version },
  );
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.session.lifecycle, undefined);
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}`, "PUT", {
        version: reopened.body.session.version,
        session: { ...reopened.body.session, title: "Open again" },
      })
    ).status,
    200,
  );
});

test("delivered report totals and filters include accessible sessions only, and closing rejects an active timer", async (t) => {
  const h = await harness(t),
    owner = await h.setup(),
    outside = await h.account("outside@example.test");
  let s = await h.session();
  const started = await h.owner.request(`/sessions/${s.id}/run`, "POST", {
    action: "start",
    revision: s.run.revision,
    dayId: s.days[0].id,
  });
  assert.equal(started.status, 200);
  s = started.body.session;
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}/lifecycle`, "POST", {
        action: "close",
        version: s.version,
      })
    ).body.code,
    "ACTIVE_RUN",
  );
  const stopped = await h.owner.request(`/sessions/${s.id}/run`, "POST", {
    action: "stop",
    revision: s.run.revision,
  });
  assert.equal(stopped.status, 200, JSON.stringify(stopped.body));
  s = stopped.body.session;
  const edited = await h.owner.request(`/sessions/${s.id}`, "PUT", {
    version: s.version,
    session: { ...s, tags: ["delivered"] },
  });
  s = edited.body.session;
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}/lifecycle`, "POST", {
        action: "close",
        version: s.version,
        facilitatorIds: [owner.id],
      })
    ).status,
    200,
  );
  const report = (
    await h.owner.request(
      `/reports/delivered?tag=delivered&facilitator=${owner.id}`,
    )
  ).body;
  assert.equal(report.sessions.length, 1);
  assert.ok(report.totalPlannedMinutes > 0);
  assert.equal(report.sessions[0].facilitators[0].id, owner.id);
  assert.equal(
    (await outside.client.request("/reports/delivered")).body.sessions.length,
    0,
  );
  assert.equal(
    (await h.owner.request("/reports/delivered?from=2099-01-01")).body.sessions
      .length,
    0,
  );
  assert.equal(
    (await h.owner.request("/reports/delivered?tag=missing")).body.sessions
      .length,
    0,
  );
});

test("trash hides sessions from collaborators and public links, then restores the same permissions within 30 days", async (t) => {
  const h = await harness(t);
  await h.setup();
  const viewer = await h.account("viewer@example.test"),
    outside = await h.account("outside@example.test"),
    s = await h.session();
  await h.db.run(
    "INSERT INTO members(session_id,user_id,role) VALUES($1,$2,$3)",
    [s.id, viewer.user.id, "viewer"],
  );
  const share = (
    await h.owner.request(`/sessions/${s.id}/shares`, "POST", {
      label: "Retained",
    })
  ).body.share;
  assert.equal(
    (
      await viewer.client.request(`/sessions/${s.id}/trash`, "POST", {
        version: s.version,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}/trash`, "POST", {
        version: s.version,
      })
    ).status,
    200,
  );
  for (const client of [h.owner, viewer.client, outside.client])
    assert.equal((await client.request(`/sessions/${s.id}`)).status, 404);
  assert.equal((await h.owner.request("/sessions")).body.sessions.length, 0);
  assert.equal(
    (await h.client().request(`/public/${share.token}`)).status,
    404,
  );
  assert.equal(
    (await outside.client.request("/trash/sessions")).body.sessions.length,
    0,
  );
  const trash = (await h.owner.request("/trash/sessions")).body.sessions[0];
  assert.equal(trash.canRestore, true);
  assert.equal(
    (Date.parse(trash.expiresAt) - Date.parse(trash.deletedAt)) / 86400000,
    30,
  );
  assert.equal(
    (await viewer.client.request("/trash/sessions")).body.sessions[0]
      .canRestore,
    false,
  );
  assert.equal(
    (
      await viewer.client.request(`/trash/sessions/${s.id}/restore`, "POST", {
        version: trash.version,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.owner.request(`/trash/sessions/${s.id}/restore`, "POST", {
        version: s.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.owner.request(`/trash/sessions/${s.id}/restore`, "POST", {
        version: trash.version,
      })
    ).status,
    200,
  );
  assert.equal((await viewer.client.request(`/sessions/${s.id}`)).status, 200);
  assert.equal(
    (await h.client().request(`/public/${share.token}`)).status,
    200,
  );
});

test("expired sessions cannot be restored and bounded cleanup deletes dependent private data", async (t) => {
  const h = await harness(t);
  await h.setup();
  const s = await h.session();
  const share = (
    await h.owner.request(`/sessions/${s.id}/shares`, "POST", {
      label: "Expired",
    })
  ).body.share;
  await h.owner.request(`/sessions/${s.id}/trash`, "POST", {
    version: s.version,
  });
  await h.db.run(
    "UPDATE session_lifecycle SET expires_at=$1 WHERE session_id=$2",
    [new Date(Date.now() - 1000).toISOString(), s.id],
  );
  assert.equal(
    (
      await h.owner.request(`/trash/sessions/${s.id}/restore`, "POST", {
        version: s.version + 1,
      })
    ).status,
    410,
  );
  assert.equal(
    (await h.owner.request("/trash/sessions")).body.sessions.length,
    0,
  );
  assert.equal(
    (await h.db.all("SELECT id FROM sessions WHERE id=$1", [s.id])).length,
    0,
  );
  assert.equal(
    (await h.db.all("SELECT id FROM shares WHERE id=$1", [share.id])).length,
    0,
  );
});

test("session CAS serializes close against editing and preserves closed state through trash restoration", async (t) => {
  const h = await harness(t);
  await h.setup();
  let s = await h.session();
  const outcomes = await Promise.all([
    h.owner.request(`/sessions/${s.id}/lifecycle`, "POST", {
      action: "close",
      version: s.version,
    }),
    h.owner.request(`/sessions/${s.id}`, "PUT", {
      version: s.version,
      session: { ...s, title: "Concurrent" },
    }),
  ]);
  assert.deepEqual(outcomes.map((item) => item.status).sort(), [200, 409]);
  s = (await h.owner.request(`/sessions/${s.id}`)).body.session;
  if (!s.lifecycle)
    s = (
      await h.owner.request(`/sessions/${s.id}/lifecycle`, "POST", {
        action: "close",
        version: s.version,
      })
    ).body.session;
  await h.owner.request(`/sessions/${s.id}/trash`, "POST", {
    version: s.version,
  });
  const row = (await h.owner.request("/trash/sessions")).body.sessions[0];
  await h.owner.request(`/trash/sessions/${s.id}/restore`, "POST", {
    version: row.version,
  });
  const restored = (await h.owner.request(`/sessions/${s.id}`)).body.session;
  assert.ok(restored.lifecycle.closedAt);
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}`, "PUT", {
        version: restored.version,
        session: restored,
      })
    ).body.code,
    "SESSION_CLOSED",
  );
});

test("lifecycle preserves scoped visitor links and closes public forms and visitor comments until reopening", async (t) => {
  const h = await harness(t);
  await h.setup();
  let s = await h.session();
  const day = s.days[0].id;
  s.days.push({
    ...s.days[0],
    id: "hidden-day",
    title: "HIDDEN_DAY",
    blocks: [newBlock("en", { title: "HIDDEN_BLOCK" })],
  });
  const form = newForm("en");
  form.questions = [newQuestion("short", "en")];
  s.forms = [form];
  s = (
    await h.owner.request(`/sessions/${s.id}`, "PUT", {
      session: s,
      version: s.version,
    })
  ).body.session;
  const share = (
    await h.owner.request(`/sessions/${s.id}/shares`, "POST", {
      label: "Scoped",
      dayIds: [day],
      initialDayId: day,
      allowComments: true,
    })
  ).body.share;
  const publication = (
    await h.owner.request(
      `/sessions/${s.id}/forms/${form.id}/publish`,
      "POST",
      { version: s.version },
    )
  ).body.publication;
  assert.ok(publication.token);
  const guest = h.client();
  assert.equal(
    (await guest.request(`/forms/${publication.token}`)).status,
    200,
  );
  s = (
    await h.owner.request(`/sessions/${s.id}/lifecycle`, "POST", {
      action: "close",
      version: s.version,
    })
  ).body.session;
  const publicClosed = await guest.request(`/public/${share.token}`);
  assert.equal(publicClosed.status, 200);
  assert.equal(publicClosed.body.session.days.length, 1);
  assert.equal(JSON.stringify(publicClosed.body).includes("HIDDEN_"), false);
  assert.equal(publicClosed.body.sharing.initialDayId, day);
  assert.equal(
    (
      await guest.request(`/public/${share.token}/comments`, "POST", {
        author: "Visitor",
        text: "Closed",
        blockId: null,
      })
    ).status,
    409,
  );
  assert.equal(
    (await guest.request(`/forms/${publication.token}`)).body.code,
    "SESSION_CLOSED",
  );
  assert.equal(
    (
      await guest.request(`/forms/${publication.token}/responses`, "POST", {
        revision: publication.revision,
        submissionId: crypto.randomUUID(),
        answers: {},
      })
    ).body.code,
    "SESSION_CLOSED",
  );
  await h.owner.request(`/sessions/${s.id}/trash`, "POST", {
    version: s.version,
  });
  assert.equal((await guest.request(`/public/${share.token}`)).status, 404);
  assert.equal(
    (await guest.request(`/forms/${publication.token}`)).status,
    404,
  );
  const trash = (await h.owner.request("/trash/sessions")).body.sessions[0];
  await h.owner.request(`/trash/sessions/${s.id}/restore`, "POST", {
    version: trash.version,
  });
  s = (await h.owner.request(`/sessions/${s.id}`)).body.session;
  const restored = await guest.request(`/public/${share.token}`);
  assert.equal(restored.status, 200);
  assert.equal(restored.body.session.days.length, 1);
  assert.equal(restored.body.sharing.initialDayId, day);
  assert.equal(
    (await guest.request(`/forms/${publication.token}`)).body.code,
    "SESSION_CLOSED",
  );
  await h.owner.request(`/sessions/${s.id}/lifecycle`, "POST", {
    action: "reopen",
    version: s.version,
  });
  assert.equal(
    (await guest.request(`/forms/${publication.token}`)).status,
    200,
  );
  assert.equal(
    (
      await guest.request(`/public/${share.token}/comments`, "POST", {
        author: "Visitor",
        text: "Reopened",
        blockId: null,
      })
    ).status,
    201,
  );
});
