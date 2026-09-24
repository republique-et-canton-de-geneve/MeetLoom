import test from "node:test";
import assert from "node:assert/strict";
import { harness, password } from "./support.js";
import type { Session } from "../shared/model.js";

test("a pending session invitation can be assigned before signup and retains its opaque ID after acceptance", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  const created = await h.owner.request(
    `/sessions/${session.id}/invitations`,
    "POST",
    {
      name: "Future facilitator",
      email: "future@example.test",
      role: "facilitator",
    },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const person = created.body.participant;
  const options = (await h.owner.request(`/sessions/${session.id}/assignees`))
    .body.participants;
  assert.ok(
    options.some((option: any) => option.id === person.id && option.pending),
  );
  assert.equal(
    options.some((option: any) => "email" in option),
    false,
  );
  session.days[0].blocks[0].assignees = [
    { id: person.id, name: "Forged label" },
  ];
  let saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  session = saved.body.session;
  assert.equal(session.days[0].blocks[0].facilitator, "Future facilitator");
  assert.equal(
    session.days[0].blocks[0].assignees?.[0].name,
    "Future facilitator",
  );
  const newcomer = h.client(),
    accepted = await newcomer.request("/auth/accept-invite", "POST", {
      token: created.body.token,
      name: "Accepted name",
      password,
      locale: "en",
    });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
  assert.equal(accepted.body.user.isAdmin, false);
  const linked = (
    await newcomer.request(`/sessions/${session.id}/assignees`)
  ).body.participants.find(
    (option: any) => option.userId === accepted.body.user.id,
  );
  assert.equal(linked.id, person.id);
  assert.equal(linked.pending, false);
  assert.equal(linked.name, "Accepted name");
  assert.equal(
    (await newcomer.request(`/sessions/${session.id}`)).body.role,
    "facilitator",
  );
  saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(saved.status, 200);
  session = saved.body.session;
  assert.equal(session.days[0].blocks[0].assignees?.[0].id, person.id);
  assert.equal(session.days[0].blocks[0].facilitator, "Accepted name");
  assert.equal(
    (
      await newcomer.request(`/sessions/${session.id}`, "PUT", {
        session,
        version: session.version,
      })
    ).status,
    403,
  );
  const duplicate = (
    await h.owner.request(`/sessions/${session.id}/duplicate`, "POST", {})
  ).body.session as Session;
  assert.equal(duplicate.days[0].blocks[0].assignees, undefined);
  assert.equal(duplicate.days[0].blocks[0].facilitator, "Accepted name");
});

test("assignment IDs cannot cross sessions and public projections expose only the configured facilitator text", async (t) => {
  const h = await harness(t),
    owner = await h.setup();
  let session = await h.session();
  const other = await h.session(),
    outsider = await h.account("outside@example.test");
  const invite = (
    await h.owner.request(`/sessions/${other.id}/invitations`, "POST", {
      name: "Elsewhere",
      email: "elsewhere@example.test",
      role: "viewer",
    })
  ).body;
  for (const personId of [invite.participant.id, outsider.user.id]) {
    const candidate = structuredClone(session);
    candidate.days[0].blocks[0].assignees = [{ id: personId, name: "Forged" }];
    assert.equal(
      (
        await h.owner.request(`/sessions/${session.id}`, "PUT", {
          session: candidate,
          version: session.version,
        })
      ).body.code,
      "INVALID_ASSIGNEE",
    );
  }
  session.days[0].blocks[0].assignees = [{ id: owner.id, name: "Wrong" }];
  session.columns.find((column) => column.id === "facilitator")!.visibility =
    "public";
  const saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  session = saved.body.session;
  const share = (
      await h.owner.request(`/sessions/${session.id}/shares`, "POST", {
        label: "Visitors",
      })
    ).body.share,
    publicSession = (await h.client().request(`/public/${share.token}`)).body
      .session;
  assert.equal(publicSession.days[0].blocks[0].facilitator, "Owner");
  assert.equal("assignees" in publicSession.days[0].blocks[0], false);
  assert.equal(JSON.stringify(publicSession).includes(owner.email), false);
  assert.equal(JSON.stringify(publicSession).includes(owner.id), false);
  assert.equal(
    (await outsider.client.request(`/sessions/${session.id}/assignees`)).status,
    404,
  );
});

test("only authorized account administrators invite new accounts, while session owners can add existing accounts", async (t) => {
  const h = await harness(t);
  await h.setup();
  const ordinary = await h.account("ordinary@example.test"),
    known = await h.account("known@example.test");
  const session = (
    await ordinary.client.request("/sessions", "POST", {
      title: "Personal session",
      locale: "en",
    })
  ).body.session;
  assert.equal(
    (
      await ordinary.client.request(
        `/sessions/${session.id}/invitations`,
        "POST",
        { name: "Unknown", email: "unknown@example.test", role: "editor" },
      )
    ).body.code,
    "ACCOUNT_INVITE_FORBIDDEN",
  );
  const added = await ordinary.client.request(
    `/sessions/${session.id}/invitations`,
    "POST",
    { name: "Known", email: known.user.email, role: "viewer" },
  );
  assert.equal(added.status, 201);
  assert.equal(added.body.token, undefined);
  assert.equal(
    (await known.client.request(`/sessions/${session.id}`)).body.role,
    "viewer",
  );
  assert.equal(
    (await known.client.request(`/sessions/${session.id}/invitations`)).status,
    403,
  );
  const workspace = (
    await ordinary.client.request("/workspaces", "POST", {
      name: "My workspace",
    })
  ).body.workspace;
  const workplace = (
    await ordinary.client.request("/sessions", "POST", {
      title: "Team session",
      workspaceId: workspace.id,
      locale: "en",
    })
  ).body.session;
  assert.equal(
    (
      await ordinary.client.request(
        `/sessions/${workplace.id}/invitations`,
        "POST",
        {
          name: "Workspace invitee",
          email: "new-workspace@example.test",
          role: "editor",
        },
      )
    ).status,
    201,
  );
});

test("reissuing or revoking a pending invitation keeps assignment history while invalidating obsolete tokens", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  const request = {
    name: "Pending",
    email: "pending@example.test",
    role: "viewer",
  };
  const first = (
    await h.owner.request(
      `/sessions/${session.id}/invitations`,
      "POST",
      request,
    )
  ).body;
  session.days[0].blocks[0].assignees = [
    { id: first.participant.id, name: "Pending" },
  ];
  session = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session,
      version: session.version,
    })
  ).body.session;
  const second = (
    await h.owner.request(
      `/sessions/${session.id}/invitations`,
      "POST",
      request,
    )
  ).body;
  assert.equal(second.participant.id, first.participant.id);
  assert.notEqual(second.token, first.token);
  assert.equal(
    (
      await h.client().request("/auth/accept-invite", "POST", {
        token: first.token,
        name: "Pending",
        password,
      })
    ).status,
    410,
  );
  assert.equal(
    (
      await h.owner.request(
        `/sessions/${session.id}/invitations/${first.participant.id}`,
        "DELETE",
        {},
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await h.client().request("/auth/accept-invite", "POST", {
        token: second.token,
        name: "Pending",
        password,
      })
    ).status,
    410,
  );
  assert.equal(
    (
      await h.owner.request(`/sessions/${session.id}/assignees`)
    ).body.participants.some(
      (person: any) => person.id === first.participant.id,
    ),
    false,
  );
  session.title = "Still editable";
  assert.equal(
    (
      await h.owner.request(`/sessions/${session.id}`, "PUT", {
        session,
        version: session.version,
      })
    ).status,
    200,
  );
});

test("the new owner can reissue an invitation after ownership is transferred", async (t) => {
  const h = await harness(t);
  await h.setup();
  const successor = await h.account("successor@example.test"),
    session = await h.session(),
    input = {
      name: "Pending",
      email: "transfer-invite@example.test",
      role: "viewer",
    };
  const first = (
    await h.owner.request(`/sessions/${session.id}/invitations`, "POST", input)
  ).body;
  assert.equal(
    (
      await h.owner.request(`/admin/accounts/${successor.user.id}`, "PATCH", {
        isAdmin: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await h.owner.request("/account/delete", "POST", {
        currentPassword: password,
        transferTo: successor.user.id,
      })
    ).status,
    200,
  );
  const stale = await h.client().request("/auth/accept-invite", "POST", {
    token: first.token,
    name: "Pending",
    password,
  });
  assert.equal(stale.status, 410);
  const reissued = await successor.client.request(
    `/sessions/${session.id}/invitations`,
    "POST",
    input,
  );
  assert.equal(reissued.status, 201, JSON.stringify(reissued.body));
  assert.equal(reissued.body.participant.id, first.participant.id);
  const newcomer = h.client();
  assert.equal(
    (
      await newcomer.request("/auth/accept-invite", "POST", {
        token: reissued.body.token,
        name: "Pending",
        password,
      })
    ).status,
    201,
  );
  assert.equal(
    (await newcomer.request(`/sessions/${session.id}`)).body.role,
    "viewer",
  );
});

test("separate pending invitations can be accepted after another invitation already created the account", async (t) => {
  const h = await harness(t);
  await h.setup();
  const first = await h.session(),
    second = await h.session(),
    input = { name: "Invitee", email: "multiple@example.test", role: "viewer" };
  const a = (
      await h.owner.request(`/sessions/${first.id}/invitations`, "POST", input)
    ).body,
    b = (
      await h.owner.request(`/sessions/${second.id}/invitations`, "POST", input)
    ).body;
  const newcomer = h.client();
  assert.equal(
    (
      await newcomer.request("/auth/accept-invite", "POST", {
        token: a.token,
        name: "Invitee",
        password,
      })
    ).status,
    201,
  );
  assert.equal((await newcomer.request(`/sessions/${second.id}`)).status, 404);
  assert.equal(
    (
      await newcomer.request("/auth/accept-session-invite", "POST", {
        token: b.token,
      })
    ).status,
    200,
  );
  assert.equal(
    (await newcomer.request(`/sessions/${second.id}`)).body.role,
    "viewer",
  );
  assert.equal(
    (
      await newcomer.request("/auth/accept-session-invite", "POST", {
        token: b.token,
      })
    ).status,
    410,
  );
});

test("disabling the last workspace administrator is refused and concurrent global admins cannot disable each other", async (t) => {
  const h = await harness(t),
    owner = await h.setup(),
    member = await h.account("workspace-admin@example.test");
  const workspace = (
    await member.client.request("/workspaces", "POST", { name: "Sole admin" })
  ).body.workspace;
  assert.equal(
    (
      await h.owner.request(`/admin/accounts/${member.user.id}`, "PATCH", {
        disabled: true,
      })
    ).body.code,
    "LAST_WORKSPACE_ADMIN",
  );
  await member.client.request(`/workspaces/${workspace.id}/members`, "POST", {
    email: owner.email,
    role: "admin",
  });
  assert.equal(
    (
      await h.owner.request(`/admin/accounts/${member.user.id}`, "PATCH", {
        disabled: true,
      })
    ).status,
    200,
  );
  await h.owner.request(`/admin/accounts/${member.user.id}`, "PATCH", {
    disabled: false,
    isAdmin: true,
  });
  await member.client.request("/auth/login", "POST", {
    email: member.user.email,
    password,
  });
  const results = await Promise.all([
    h.owner.request(`/admin/accounts/${member.user.id}`, "PATCH", {
      disabled: true,
    }),
    member.client.request(`/admin/accounts/${owner.id}`, "PATCH", {
      disabled: true,
    }),
  ]);
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(
    (
      await h.db.all(
        "SELECT u.id FROM users u WHERE u.is_admin=1 AND NOT EXISTS(SELECT 1 FROM account_disabled d WHERE d.user_id=u.id)",
      )
    ).length,
    1,
  );
});
