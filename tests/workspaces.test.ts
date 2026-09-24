import test from "node:test";
import assert from "node:assert/strict";
import { harness, password } from "./support.js";
import { removeAccountMembership } from "../server/workspaces.js";

test("workspaces enforce inherited roles, privileged mapping, guests and private defaults", async (t) => {
  const h = await harness(t),
    owner = await h.setup(),
    editor = await h.account("editor@example.test"),
    viewer = await h.account("viewer@example.test"),
    outsider = await h.account("outside@example.test");
  const created = await h.owner.request("/workspaces", "POST", {
    name: "Design team",
  });
  assert.equal(created.status, 201);
  const w = created.body.workspace;
  for (const [person, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ] as const)
    assert.equal(
      (
        await h.owner.request(`/workspaces/${w.id}/members`, "POST", {
          email: person.user.email,
          role,
        })
      ).status,
      201,
    );
  const configured = await h.owner.request(`/workspaces/${w.id}`, "PUT", {
    name: w.name,
    version: w.version,
    settings: {
      organization: "Org",
      defaults: {
        columns: [
          { id: "private", label: "Prompt", visibility: "team", visible: true },
        ],
        pages: [
          {
            id: "page",
            title: "Brief",
            visibility: "team",
            sections: [{ id: "sect", content: "Internal starter" }],
          },
        ],
        export: { audience: "team", landscape: true },
      },
    },
  });
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  const a = await editor.client.request("/sessions", "POST", {
    title: "Workspace agenda",
    workspaceId: w.id,
  });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.session.workspaceId, w.id);
  assert.equal(a.body.session.columns[0].id, "private");
  assert.equal(a.body.session.pages[0].sections[0].content, "Internal starter");
  const sid = a.body.session.id;
  assert.equal(
    (await viewer.client.request(`/sessions/${sid}`)).body.role,
    "viewer",
  );
  assert.equal((await h.owner.request(`/sessions/${sid}`)).body.role, "editor");
  assert.equal((await outsider.client.request(`/sessions/${sid}`)).status, 404);
  assert.equal(
    (
      await viewer.client.request("/sessions", "POST", {
        title: "No",
        workspaceId: w.id,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await viewer.client.request(`/sessions/${sid}`, "PUT", {
        version: 1,
        session: a.body.session,
      })
    ).status,
    403,
  );
  const forged = await editor.client.request(`/sessions/${sid}`, "PUT", {
    version: a.body.session.version,
    session: { ...a.body.session, workspaceId: "forged" },
  });
  assert.equal(forged.status, 200, JSON.stringify(forged.body));
  assert.equal(
    (await editor.client.request(`/sessions/${sid}`)).body.session.workspaceId,
    w.id,
  );
  const payload = (
    await h.db.all<{ payload: string }>(
      "SELECT payload FROM sessions WHERE id=$1",
      [sid],
    )
  )[0].payload;
  assert.equal(JSON.parse(payload).workspaceId, undefined);
  await h.db.run(
    "INSERT INTO members(session_id,user_id,role) VALUES($1,$2,$3)",
    [sid, outsider.user.id, "facilitator"],
  );
  assert.equal(
    (await outsider.client.request("/workspaces")).body.workspaces[0].role,
    "guest",
  );
  assert.equal(
    (await outsider.client.request(`/workspaces/${w.id}`)).status,
    404,
  );
  assert.deepEqual(
    (await outsider.client.request(`/sessions/${sid}/workspace-defaults`)).body,
    { export: { audience: "team", landscape: true } },
  );
  const members = (await h.owner.request(`/workspaces/${w.id}/members`)).body
    .members;
  assert.equal(
    members.find((m: any) => m.userId === outsider.user.id).sessions[0].id,
    sid,
  );
  assert.equal(
    (
      await h.owner.request(
        `/workspaces/${w.id}/members/${outsider.user.id}`,
        "DELETE",
        {},
      )
    ).status,
    200,
  );
  assert.equal((await outsider.client.request(`/sessions/${sid}`)).status, 404);
  const copy = await viewer.client.request(
    `/sessions/${sid}/duplicate`,
    "POST",
    {},
  );
  assert.equal(copy.status, 201);
  assert.equal(copy.body.session.workspaceId, undefined);
  assert.equal(
    (await h.owner.request(`/sessions/${copy.body.session.id}`)).status,
    404,
  );
  assert.equal(
    (
      await h.owner.request(
        `/workspaces/${w.id}/members/${owner.id}`,
        "PATCH",
        { role: "viewer" },
      )
    ).body.code,
    "LAST_WORKSPACE_ADMIN",
  );
});

test("workspace invitations are consumed once and do not survive administrator revocation", async (t) => {
  const h = await harness(t);
  await h.setup();
  const admin = await h.account("admin@example.test");
  const w = (await h.owner.request("/workspaces", "POST", { name: "Team" }))
    .body.workspace;
  await h.owner.request(`/workspaces/${w.id}/members`, "POST", {
    email: admin.user.email,
    role: "admin",
  });
  const invited = await admin.client.request(
    `/workspaces/${w.id}/members`,
    "POST",
    { email: "new@example.test", role: "editor" },
  );
  assert.equal(invited.status, 201);
  const recipient = h.client(),
    accepted = await recipient.request("/auth/accept-invite", "POST", {
      token: invited.body.token,
      name: "New",
      password,
      locale: "en",
    });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(
    (await recipient.request(`/workspaces/${w.id}`)).body.role,
    "editor",
  );
  assert.equal(
    (
      await h.client().request("/auth/accept-invite", "POST", {
        token: invited.body.token,
        name: "Again",
        password,
        locale: "en",
      })
    ).status,
    410,
  );
  const next = await admin.client.request(
    `/workspaces/${w.id}/members`,
    "POST",
    { email: "blocked@example.test", role: "admin" },
  );
  await h.owner.request(
    `/workspaces/${w.id}/members/${admin.user.id}`,
    "PATCH",
    { role: "viewer" },
  );
  assert.equal(
    (
      await h.client().request("/auth/accept-invite", "POST", {
        token: next.body.token,
        name: "Blocked",
        password,
        locale: "en",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await h.db.all("SELECT id FROM users WHERE email=$1", [
        "blocked@example.test",
      ])
    ).length,
    0,
  );
  assert.equal(
    (
      await recipient.request(`/workspaces/${w.id}/members`, "POST", {
        email: "no@example.test",
        role: "admin",
      })
    ).status,
    403,
  );
});

test("moving between workspaces requires owner and destination editor, uses CAS, and alters inherited access", async (t) => {
  const h = await harness(t);
  await h.setup();
  const member = await h.account("member@example.test"),
    viewer = await h.account("view@example.test");
  const a = (await h.owner.request("/workspaces", "POST", { name: "A" })).body
      .workspace,
    b = (await member.client.request("/workspaces", "POST", { name: "B" })).body
      .workspace;
  await h.owner.request(`/workspaces/${a.id}/members`, "POST", {
    email: viewer.user.email,
    role: "viewer",
  });
  let s = await h.session();
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}/workspace`, "PUT", {
        workspaceId: b.id,
        version: s.version,
      })
    ).status,
    404,
  );
  let moved = await h.owner.request(`/sessions/${s.id}/workspace`, "PUT", {
    workspaceId: a.id,
    version: s.version,
  });
  assert.equal(moved.status, 200);
  s = moved.body.session;
  assert.equal((await viewer.client.request(`/sessions/${s.id}`)).status, 200);
  assert.equal(
    (
      await h.owner.request(`/sessions/${s.id}/workspace`, "PUT", {
        workspaceId: null,
        version: s.version - 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await viewer.client.request(`/sessions/${s.id}/workspace`, "PUT", {
        workspaceId: null,
        version: s.version,
      })
    ).status,
    403,
  );
  assert.equal(
    (await h.owner.request(`/workspaces/${a.id}`, "DELETE", {})).status,
    409,
  );
  moved = await h.owner.request(`/sessions/${s.id}/workspace`, "PUT", {
    workspaceId: null,
    version: s.version,
  });
  assert.equal(moved.status, 200);
  assert.equal((await viewer.client.request(`/sessions/${s.id}`)).status, 404);
  assert.equal(
    (await h.owner.request(`/workspaces/${a.id}`, "DELETE", {})).status,
    200,
  );
});

test("workspace defaults validate identifiers, clone forms privately, and allow demos with replacement columns", async (t) => {
  const h = await harness(t);
  await h.setup();
  let w = (await h.owner.request("/workspaces", "POST", { name: "Presets" }))
    .body.workspace;
  const update = (defaults: unknown, version = w.version) =>
    h.owner.request(`/workspaces/${w.id}`, "PUT", {
      name: w.name,
      version,
      settings: { organization: "", defaults },
    });
  assert.equal(
    (
      await update({
        categories: [{ id: "opening", label: "Reserved", color: "#123456" }],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await update({
        columns: [
          { id: "a", label: "One", visibility: "team", visible: true },
          { id: "a", label: "Two", visibility: "team", visible: true },
        ],
      })
    ).status,
    400,
  );
  w = (
    await update({
      columns: [
        { id: "notes", label: "Notes", visibility: "team", visible: true },
      ],
      categories: [{ id: "custom", label: "Custom", color: "#123456" }],
      forms: [
        {
          id: "survey",
          title: "Survey",
          description: "",
          identityMode: "anonymous",
          questions: [
            {
              id: "q",
              title: "Question",
              description: "",
              required: false,
              type: "short",
            },
          ],
        },
      ],
      timezone: "Europe/Paris",
      startTime: "10:30",
    })
  ).body.workspace;
  const first = await h.owner.request("/sessions", "POST", {
      title: "One",
      workspaceId: w.id,
      demo: true,
    }),
    second = await h.owner.request("/sessions", "POST", {
      title: "Two",
      workspaceId: w.id,
      demo: true,
    });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201);
  assert.notEqual(
    first.body.session.forms[0].id,
    second.body.session.forms[0].id,
  );
  assert.notEqual(
    first.body.session.forms[0].questions[0].id,
    second.body.session.forms[0].questions[0].id,
  );
  assert.equal(first.body.session.days[0].startTime, "10:30");
  assert.equal(first.body.session.timezone, "Europe/Paris");
  assert.equal((await h.db.all("SELECT id FROM form_publications")).length, 0);
  assert.equal((await update({}, w.version - 1)).status, 409);
  const current = (await h.owner.request(`/workspaces/${w.id}`)).body.workspace;
  assert.equal(current.settings.defaults.forms[0].id, "survey");
});

test("workspace administrators cannot concurrently remove the last admin and account departure transfers administration", async (t) => {
  const h = await harness(t),
    owner = await h.setup(),
    other = await h.account("second-admin@example.test"),
    recipient = await h.account("recipient@example.test");
  const w = (await h.owner.request("/workspaces", "POST", { name: "Durable" }))
    .body.workspace;
  await h.owner.request(`/workspaces/${w.id}/members`, "POST", {
    email: other.user.email,
    role: "admin",
  });
  const results = await Promise.all([
    h.owner.request(`/workspaces/${w.id}/members/${owner.id}`, "PATCH", {
      role: "viewer",
    }),
    other.client.request(
      `/workspaces/${w.id}/members/${other.user.id}`,
      "PATCH",
      { role: "viewer" },
    ),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const admins = await h.db.all<{ user_id: string }>(
    "SELECT user_id FROM workspace_members WHERE workspace_id=$1 AND role='admin'",
    [w.id],
  );
  assert.equal(admins.length, 1);
  await assert.rejects(
    () =>
      h.db.transaction((sql) =>
        removeAccountMembership(sql, admins[0].user_id),
      ),
    /Transfer your workspaces/,
  );
  await h.db.transaction((sql) =>
    removeAccountMembership(sql, admins[0].user_id, recipient.user.id),
  );
  assert.equal(
    (await recipient.client.request(`/workspaces/${w.id}`)).body.role,
    "admin",
  );
});
