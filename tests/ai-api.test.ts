import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { harness, listen, stop } from "./support.js";
import { boundedAgendaContext } from "../server/ai-context.js";

async function fixture(t: Parameters<typeof harness>[0]) {
  let answer: unknown = { answer: "Advice", operations: [] };
  let received = "";
  const provider = createServer(async (request, response) => {
    let body = "";
    for await (const part of request) body += part;
    received = body;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify(answer) } }],
      }),
    );
  });
  const address = await listen(provider);
  t.after(() => stop(provider));
  const h = await harness(t, {
    ai: { baseUrl: address, model: "internal-test" },
  });
  await h.setup();
  const session = await h.session();
  const base = `/sessions/${session.id}/ai/conversations`;
  return {
    ...h,
    session,
    base,
    setAnswer: (value: unknown) => {
      answer = value;
    },
    received: () => received,
  };
}

test("AI workspace and all scopes snapshot only authorized active agendas and recheck revocation", async (t) => {
  const h = await fixture(t),
    reader = await h.account("scope-reader@example.test");
  const first = (
    await h.owner.request("/workspaces", "POST", { name: "First scope" })
  ).body.workspace;
  const second = (
    await h.owner.request("/workspaces", "POST", { name: "Second scope" })
  ).body.workspace;
  for (const workspace of [first, second])
    assert.equal(
      (
        await h.owner.request(`/workspaces/${workspace.id}/members`, "POST", {
          email: reader.user.email,
          role: "viewer",
        })
      ).status,
      201,
    );
  const create = async (title: string, workspaceId: string) => {
    const result = await h.owner.request("/sessions", "POST", {
      title,
      workspaceId,
      demo: true,
    });
    assert.equal(result.status, 201);
    return result.body.session;
  };
  const target = await create("CURRENT_WORKSPACE_CONTEXT", first.id),
    peer = await create("SAME_WORKSPACE_CONTEXT", first.id),
    other = await create("OTHER_WORKSPACE_CONTEXT", second.id),
    archived = await create("ARCHIVED_CONTEXT_EXCLUDED", second.id);
  other.days[0].blocks[0].fields.notes = "PRIVATE_WORKSPACE_SENTINEL";
  assert.equal(
    (
      await h.owner.request(`/sessions/${other.id}`, "PUT", {
        session: other,
        version: other.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await h.owner.request(`/sessions/${archived.id}`, "PUT", {
        session: { ...archived, archived: true },
        version: archived.version,
      })
    ).status,
    200,
  );
  const base = `/sessions/${target.id}/ai/conversations`;
  const workspace = await reader.client.request(base, "POST", {
    contextMode: "workspace",
  });
  assert.equal(workspace.status, 201, JSON.stringify(workspace.body));
  assert.deepEqual(
    new Set(workspace.body.conversation.contextIds),
    new Set([target.id, peer.id]),
  );
  const all = await reader.client.request(base, "POST", {
    contextMode: "all",
    includePrivate: false,
  });
  assert.equal(all.status, 201);
  assert.deepEqual(
    new Set(all.body.conversation.contextIds),
    new Set([target.id, peer.id, other.id]),
  );
  assert.ok(!all.body.conversation.contextIds.includes(h.session.id));
  const response = await reader.client.request(
    `${base}/${all.body.conversation.id}/messages`,
    "POST",
    {
      prompt: "Compare these agendas",
      locale: "en",
      version: target.version,
      revision: 0,
    },
  );
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.contextSummary.sessions, 3);
  assert.ok(h.received().includes("OTHER_WORKSPACE_CONTEXT"));
  assert.ok(!h.received().includes("PRIVATE_WORKSPACE_SENTINEL"));
  assert.ok(!h.received().includes("ARCHIVED_CONTEXT_EXCLUDED"));
  assert.equal(
    (
      await h.owner.request(
        `/workspaces/${second.id}/members/${reader.user.id}`,
        "DELETE",
        {},
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await reader.client.request(
        `${base}/${all.body.conversation.id}/messages`,
        "POST",
        { prompt: "Again", locale: "en", version: target.version, revision: 1 },
      )
    ).status,
    404,
  );
});

test("bounded AI context retains a catalog entry for every agenda and reports shortening", () => {
  const values = Array.from({ length: 200 }, (_, index) => ({
    id: `session-${index}`,
    title: "A".repeat(240),
    description: '"\\\n'.repeat(30000),
  }));
  const result = boundedAgendaContext(values);
  assert.ok(result.truncated);
  assert.ok(result.text.length <= 60000);
  assert.equal(JSON.parse(result.text).length, 200);
  assert.equal(JSON.parse(result.text)[199].id, "session-199");
  assert.deepEqual(boundedAgendaContext([{ id: "one", title: "Small" }]), {
    text: '[{"id":"one","title":"Small"}]',
    truncated: false,
    sessions: 1,
  });
});
test("AI conversation persists privately and applies a reviewed proposal with session CAS", async (t) => {
  const h = await fixture(t);
  const created = await h.owner.request(h.base, "POST", {
    contextMode: "current",
    includePrivate: false,
  });
  assert.equal(created.status, 201);
  const chat = created.body.conversation;
  h.setAnswer({
    answer: "Shorter opening",
    operations: [
      {
        type: "update_block",
        blockId: h.session.days[0].blocks[0].id,
        changes: { duration: 7 },
      },
    ],
  });
  const reply = await h.owner.request(`${h.base}/${chat.id}/messages`, "POST", {
    prompt: "Shorten the opening",
    locale: "en",
    version: h.session.version,
    revision: 0,
    dayId: h.session.days[0].id,
  });
  assert.equal(reply.status, 201, JSON.stringify(reply.body));
  assert.equal(reply.body.messages.length, 2);
  const proposal = reply.body.messages[1];
  assert.equal(
    (await h.owner.request(`/sessions/${h.session.id}`)).body.session.days[0]
      .blocks[0].duration,
    h.session.days[0].blocks[0].duration,
  );
  const accepted = await h.owner.request(
    `${h.base}/${chat.id}/messages/${proposal.id}/decision`,
    "POST",
    { decision: "apply", version: h.session.version, locale: "en" },
  );
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  assert.equal(accepted.body.session.days[0].blocks[0].duration, 7);
  assert.equal(accepted.body.message.decision, "applied");
  assert.equal(
    (
      await h.owner.request(
        `${h.base}/${chat.id}/messages/${proposal.id}/decision`,
        "POST",
        {
          decision: "apply",
          version: accepted.body.session.version,
          locale: "en",
        },
      )
    ).status,
    409,
  );
  const loaded = await h.owner.request(`${h.base}/${chat.id}`);
  assert.equal(loaded.body.messages[1].decision, "applied");
  const editor = await h.account("editor-ai@example.test");
  await h.owner.request(`/sessions/${h.session.id}/members`, "POST", {
    email: editor.user.email,
    role: "editor",
  });
  assert.equal(
    (await editor.client.request(`${h.base}/${chat.id}`)).status,
    404,
  );
  assert.equal(
    (await editor.client.request(h.base)).body.conversations.length,
    0,
  );
});
test("AI refuses arbitrary patches, stale agenda proposals, and removed context permissions", async (t) => {
  const h = await fixture(t);
  const chat = (await h.owner.request(h.base, "POST", { contextMode: "none" }))
    .body.conversation;
  h.setAnswer({
    answer: "Unsafe",
    operations: [{ type: "update_session", ownerId: "other" }],
  });
  assert.equal(
    (
      await h.owner.request(`${h.base}/${chat.id}/messages`, "POST", {
        prompt: "Try",
        locale: "en",
        version: h.session.version,
        revision: 0,
      })
    ).status,
    502,
  );
  h.setAnswer({
    answer: "Rename",
    operations: [{ type: "update_session", title: "AI title" }],
  });
  const reply = await h.owner.request(`${h.base}/${chat.id}/messages`, "POST", {
    prompt: "Rename",
    locale: "en",
    version: h.session.version,
    revision: 0,
  });
  const changed = await h.owner.request(`/sessions/${h.session.id}`, "PUT", {
    session: { ...h.session, title: "Human title" },
    version: h.session.version,
  });
  assert.equal(
    (
      await h.owner.request(
        `${h.base}/${chat.id}/messages/${reply.body.messages[1].id}/decision`,
        "POST",
        {
          decision: "apply",
          version: changed.body.session.version,
          locale: "en",
        },
      )
    ).status,
    409,
  );
  assert.equal(
    (await h.owner.request(`/sessions/${h.session.id}`)).body.session.title,
    "Human title",
  );
  const second = (
    await h.owner.request("/sessions", "POST", {
      title: "Second context",
      locale: "en",
      demo: true,
    })
  ).body.session;
  const collaborator = await h.account("context-ai@example.test");
  for (const id of [h.session.id, second.id])
    await h.owner.request(`/sessions/${id}/members`, "POST", {
      email: collaborator.user.email,
      role: "viewer",
    });
  const selected = await collaborator.client.request(h.base, "POST", {
    contextMode: "selected",
    contextIds: [second.id],
  });
  assert.equal(selected.status, 201);
  const revoked = await h.owner.request(
    `/sessions/${second.id}/members/${collaborator.user.id}`,
    "DELETE",
  );
  assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
  assert.equal(
    (
      await collaborator.client.request(
        `${h.base}/${selected.body.conversation.id}`,
      )
    ).status,
    404,
  );
});
test("AI context requires explicit private notes selection and preferences are owned by the account", async (t) => {
  const h = await fixture(t);
  const session = structuredClone(h.session);
  session.days[0].blocks[0].fields.notes = "SECRET_PROMPTER";
  const saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  await h.owner.request("/ai/preferences", "PUT", {
    content: "PREFER_SMALL_GROUPS",
  });
  const preset = await h.owner.request("/ai/instructions", "POST", {
    title: "Policy",
    content: "PREFER_SHORT_BREAKS",
  });
  assert.equal(preset.status, 201);
  const chat = (
    await h.owner.request(h.base, "POST", {
      contextMode: "current",
      instructionSetId: preset.body.instruction.id,
    })
  ).body.conversation;
  await h.owner.request(`${h.base}/${chat.id}/messages`, "POST", {
    prompt: "Advise",
    locale: "en",
    version: saved.body.session.version,
    revision: 0,
  });
  assert.equal(h.received().includes("SECRET_PROMPTER"), false);
  assert.equal(h.received().includes("PREFER_SMALL_GROUPS"), true);
  assert.equal(h.received().includes("PREFER_SHORT_BREAKS"), true);
  const privateChat = (
    await h.owner.request(h.base, "POST", {
      contextMode: "current",
      includePrivate: true,
    })
  ).body.conversation;
  await h.owner.request(`${h.base}/${privateChat.id}/messages`, "POST", {
    prompt: "Advise",
    locale: "en",
    version: saved.body.session.version,
    revision: 0,
  });
  assert.equal(h.received().includes("SECRET_PROMPTER"), true);
  const other = await h.account("preferences-ai@example.test");
  assert.equal(
    (await other.client.request("/ai/preferences")).body.content,
    "",
  );
  assert.equal(
    (
      await other.client.request("/ai/instructions", "POST", {
        title: "Forbidden",
        content: "Policy",
      })
    ).status,
    403,
  );
});
test("accept/reject race commits exactly one decision with matching agenda state", async (t) => {
  const h = await fixture(t),
    chat = (await h.owner.request(h.base, "POST", { contextMode: "current" }))
      .body.conversation;
  h.setAnswer({
    answer: "New title",
    operations: [{ type: "update_session", title: "Accepted only" }],
  });
  const reply = await h.owner.request(`${h.base}/${chat.id}/messages`, "POST", {
    prompt: "Rename",
    locale: "en",
    version: h.session.version,
    revision: 0,
  });
  const path = `${h.base}/${chat.id}/messages/${reply.body.messages[1].id}/decision`;
  const results = await Promise.all(
    ["apply", "reject"].map((decision) =>
      h.owner.request(path, "POST", {
        decision,
        version: h.session.version,
        locale: "en",
      }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
  const decision = (await h.owner.request(`${h.base}/${chat.id}`)).body
    .messages[1].decision;
  const title = (await h.owner.request(`/sessions/${h.session.id}`)).body
    .session.title;
  assert.equal(title === "Accepted only", decision === "applied");
});
