import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { harness, origin } from "./support.js";
import { request as httpRequest } from "node:http";
import { newBlock } from "../shared/domain.js";
import { newPage } from "../shared/content.js";
import { appVersion } from "../server/version.js";
// Node fetch normalizes Host to the test listener URL. Use native HTTP so the
// configured public host can be exercised without changing DNS on the machine.
const localFetch: typeof fetch = async (input, init) =>
  new Promise((resolve, reject) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    headers.host = new URL(origin).host;
    const request = httpRequest(
      String(input),
      { method: init?.method, headers },
      (response) => {
        const parts: Buffer[] = [];
        response.on("data", (part) => parts.push(part));
        response.on("error", reject);
        response.on("end", () =>
          resolve(
            new Response(
              response.statusCode === 202 ? null : Buffer.concat(parts),
              {
                status: response.statusCode,
                headers: response.headers as Record<string, string>,
              },
            ),
          ),
        );
      },
    );
    request.on("error", reject);
    request.end(init?.body);
  });
async function connect(base: string, token: string) {
  const client = new Client({ name: "meetloom-test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      fetch: localFetch,
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}
const value = (result: any) => JSON.parse(result.content[0].text);
test("MCP SDK client negotiates stateless transport and read tokens cannot leak private fields or leave their session scope", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session(),
    other = await h.session();
  session.days[0].blocks[0].fields.notes = "MCP_PRIVATE_SENTINEL";
  assert.equal(
    (
      await h.owner.request(`/sessions/${session.id}`, "PUT", {
        session,
        version: session.version,
      })
    ).status,
    200,
  );
  const grant = await h.owner.request("/mcp/tokens", "POST", {
    label: "Internal reader",
    sessionIds: [session.id],
    includePrivate: false,
    write: false,
    expiresInDays: 7,
  });
  assert.equal(grant.status, 201, JSON.stringify(grant.body));
  const client = await connect(h.base, grant.body.token);
  t.after(() => client.close());
  // Connectors see the installed version, not the one of the first release.
  assert.equal(client.getServerVersion()?.version, appVersion().version);
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
    "get_session",
    "search_sessions",
  ]);
  const read = await client.callTool({
    name: "get_session",
    arguments: { sessionId: session.id },
  });
  assert.equal(read.isError, undefined);
  assert.ok(!JSON.stringify(read).includes("MCP_PRIVATE_SENTINEL"));
  const outside = await client.callTool({
    name: "get_session",
    arguments: { sessionId: other.id },
  });
  assert.equal(outside.isError, true);
  assert.equal(value(outside).code, "MCP_SCOPE");
  assert.equal(
    value(
      await client.callTool({
        name: "search_sessions",
        arguments: { query: "Workshop" },
      }),
    ).sessions.length,
    1,
  );
  const list = await h.owner.request("/mcp/tokens");
  assert.ok(!JSON.stringify(list.body).includes(grant.body.token));
  assert.ok(list.body.tokens[0].lastUsedAt);
  await h.owner.request(`/mcp/tokens/${grant.body.metadata.id}`, "DELETE");
  await assert.rejects(client.listTools());
});
test("MCP writes use current versions, enforce private-field scope and create history; hostile origins and cookie-only calls fail", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  const grant = await h.owner.request("/mcp/tokens", "POST", {
    label: "Internal editor",
    sessionIds: [session.id],
    includePrivate: false,
    write: true,
  });
  assert.equal(grant.status, 201);
  const client = await connect(h.base, grant.body.token);
  t.after(() => client.close());
  const created = await client.callTool({
    name: "create_day",
    arguments: {
      sessionId: session.id,
      expectedVersion: session.version,
      title: "Day two",
      date: "2026-10-20",
      startTime: "09:00",
    },
  });
  assert.equal(created.isError, undefined, JSON.stringify(created));
  session = value(created).session;
  assert.equal(session.days.length, 2);
  const bad = await client.callTool({
    name: "edit_agenda",
    arguments: {
      sessionId: session.id,
      expectedVersion: session.version,
      locale: "fr",
      operations: [
        {
          type: "update_block",
          blockId: session.days[0].blocks[0].id,
          changes: { fields: { notes: "MCP private overwrite" } },
        },
      ],
    },
  });
  assert.equal(value(bad).code, "MCP_SCOPE");
  const edited = await client.callTool({
    name: "edit_agenda",
    arguments: {
      sessionId: session.id,
      expectedVersion: session.version,
      locale: "fr",
      operations: [
        {
          type: "update_block",
          blockId: session.days[0].blocks[0].id,
          changes: { duration: 13 },
        },
      ],
    },
  });
  assert.equal(edited.isError, undefined, JSON.stringify(edited));
  assert.equal(value(edited).session.days[0].blocks[0].duration, 13);
  const stale = await client.callTool({
    name: "create_day",
    arguments: {
      sessionId: session.id,
      expectedVersion: session.version,
      title: "Stale",
      date: "2026-10-21",
      startTime: "09:00",
    },
  });
  assert.equal(value(stale).code, "VERSION_CONFLICT");
  const versions = await h.owner.request(`/sessions/${session.id}/versions`);
  assert.ok(JSON.stringify(versions.body).includes("MCP"));
  const hostile = await localFetch(`${h.base}/mcp`, {
    method: "POST",
    headers: {
      Host: new URL(origin).host,
      Origin: "https://attacker.test",
      Authorization: `Bearer ${grant.body.token}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(hostile.status, 403);
  const missing = await localFetch(`${h.base}/mcp`, {
    method: "POST",
    headers: { Host: new URL(origin).host, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(missing.status, 401);
  await h.db.run("UPDATE mcp_tokens SET expires_at=$1 WHERE id=$2", [
    "2000-01-01T00:00:00.000Z",
    grant.body.metadata.id,
  ]);
  await assert.rejects(client.listTools());
});
test("MCP tokens retain fresh user permissions and never allow viewers to issue write grants", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session(),
    viewer = await h.account("mcp-viewer@example.test");
  await h.owner.request(`/sessions/${session.id}/members`, "POST", {
    email: viewer.user.email,
    role: "viewer",
  });
  assert.equal(
    (
      await viewer.client.request("/mcp/tokens", "POST", {
        label: "Escalation",
        sessionIds: [session.id],
        write: true,
      })
    ).status,
    403,
  );
  const grant = await viewer.client.request("/mcp/tokens", "POST", {
    label: "Reader",
    sessionIds: [session.id],
    includePrivate: true,
  });
  assert.equal(grant.status, 201);
  const client = await connect(h.base, grant.body.token);
  t.after(() => client.close());
  await h.owner.request(
    `/sessions/${session.id}/members/${viewer.user.id}`,
    "DELETE",
  );
  const result = await client.callTool({
    name: "get_session",
    arguments: { sessionId: session.id },
  });
  assert.equal(result.isError, true);
  assert.equal(value(result).code, "NOT_FOUND");
});

test("public-scope MCP writes preserve private session content and descendants while permitting new client-provided content", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  session.description = "PRIVATE_SESSION_SENTINEL";
  const child = newBlock("en", { fields: { notes: "PRIVATE_CHILD_SENTINEL" } }),
    group = newBlock("en", {
      kind: "group",
      title: "Group",
      children: [child],
    });
  session.days[0].blocks = [group];
  session.pages = [newPage("en")];
  session = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session,
      version: session.version,
    })
  ).body.session;
  const grant = (
    await h.owner.request("/mcp/tokens", "POST", {
      label: "Public editor",
      sessionIds: [session.id],
      write: true,
    })
  ).body;
  const client = await connect(h.base, grant.token);
  t.after(() => client.close());
  for (const operation of [
    { type: "update_session", description: "" },
    { type: "delete_blocks", blockIds: [group.id] },
    {
      type: "update_page",
      pageId: session.pages[0].id,
      title: "Changed private page",
    },
  ]) {
    const rejected = await client.callTool({
      name: "edit_agenda",
      arguments: {
        sessionId: session.id,
        expectedVersion: session.version,
        locale: "en",
        operations: [operation],
      },
    });
    assert.equal(value(rejected).code, "MCP_SCOPE");
  }
  const created = await client.callTool({
    name: "edit_agenda",
    arguments: {
      sessionId: session.id,
      expectedVersion: session.version,
      locale: "en",
      operations: [
        {
          type: "create_page",
          title: "New private client draft",
          content: "Client-provided content",
        },
      ],
    },
  });
  assert.equal(created.isError, undefined, JSON.stringify(created));
  session = (await h.owner.request(`/sessions/${session.id}`)).body.session;
  assert.equal(session.description, "PRIVATE_SESSION_SENTINEL");
  assert.equal(
    session.days[0].blocks[0].children[0].fields.notes,
    "PRIVATE_CHILD_SENTINEL",
  );
  assert.equal(session.pages.length, 2);
  assert.ok(!JSON.stringify(created).includes("PRIVATE_SESSION_SENTINEL"));
  assert.ok(!JSON.stringify(created).includes("PRIVATE_CHILD_SENTINEL"));
  const privateGrant = (
    await h.owner.request("/mcp/tokens", "POST", {
      label: "Private editor",
      sessionIds: [session.id],
      write: true,
      includePrivate: true,
    })
  ).body;
  const privateClient = await connect(h.base, privateGrant.token);
  t.after(() => privateClient.close());
  const deleted = await privateClient.callTool({
    name: "edit_agenda",
    arguments: {
      sessionId: session.id,
      expectedVersion: session.version,
      locale: "en",
      operations: [{ type: "delete_blocks", blockIds: [group.id] }],
    },
  });
  assert.equal(deleted.isError, undefined, JSON.stringify(deleted));
});
