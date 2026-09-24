import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { randomUUID, scryptSync } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Pool } from "pg";
import { createApp, type AppConfig } from "../server/app.js";
import { readConfig } from "../server/config.js";
import type { Session } from "../shared/model.js";
import { allBlocks, newBlock } from "../shared/domain.js";

const origin = "http://meetloom.test";
const password = "correct-horse-battery-123";

test("nested rooms preserve authorization, public privacy, fresh clone IDs and timer boundaries", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  const child = newBlock("en", {
    title: "Nested activity",
    fields: { notes: "PRIVATE_CHILD_NOTES" },
  });
  const group = newBlock("en", {
    kind: "group",
    title: "Group",
    children: [child],
  });
  const deep = newBlock("en", {
    title: "Room activity",
    description: "PRIVATE_ROOM_DESCRIPTION",
    fields: { notes: "PRIVATE_ROOM_NOTES" },
    category: "custom-cat",
  });
  const parallel = newBlock("en", {
    kind: "parallel",
    title: "Rooms",
    rooms: [
      { id: "room-alpha", title: "A", blocks: [deep] },
      {
        id: "room-beta",
        title: "B",
        blocks: [newBlock("en", { duration: 20 })],
      },
    ],
  });
  session.days[0].blocks = [group, parallel];
  session.columns.find((column) => column.id === "description")!.visibility =
    "team";
  session.client = "PRIVATE_CLIENT";
  session.tags = ["PRIVATE_TAG"];
  session.folder = "PRIVATE_FOLDER";
  session.categories = [
    { id: "custom-cat", label: "Discovery", color: "#123ABC" },
    { id: "unused-cat", label: "PRIVATE_UNUSED_CATEGORY", color: "#FFFFFF" },
  ];
  const saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const summary = (await h.owner.request("/sessions")).body.sessions[0];
  assert.equal(summary.duration, 30);
  assert.equal(summary.client, "PRIVATE_CLIENT");
  assert.deepEqual(summary.tags, ["PRIVATE_TAG"]);
  assert.equal(summary.folder, "PRIVATE_FOLDER");
  const share = await h.owner.request(
    `/sessions/${session.id}/shares`,
    "POST",
    { label: "Nested visitors" },
  );
  const visitor = await h.client().request(`/public/${share.body.share.token}`);
  assert.equal(visitor.status, 200);
  assert.equal(JSON.stringify(visitor.body).includes("PRIVATE_"), false);
  assert.deepEqual(visitor.body.session.categories, [
    { id: "custom-cat", label: "Discovery", color: "#123ABC" },
  ]);
  assert.equal(
    visitor.body.session.days[0].blocks[1].rooms[0].blocks[0].fields.notes,
    undefined,
  );
  const stranger = await h.account("tree-stranger@example.test");
  assert.equal(
    (
      await stranger.client.request(
        `/sessions/${session.id}/comments`,
        "POST",
        { blockId: child.id, text: "No access" },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await h.owner.request(`/sessions/${session.id}/comments`, "POST", {
        blockId: deep.id,
        text: "Private room comment",
      })
    ).status,
    201,
  );
  const started = await h.owner.request(`/sessions/${session.id}/run`, "POST", {
    action: "start",
  });
  assert.equal(started.status, 200, "parallel rooms no longer block the timer");
  const reset = await h.owner.request(`/sessions/${session.id}/run`, "POST", {
    action: "reset",
  });
  assert.equal(reset.status, 200);
  saved.body.session = reset.body.session;
  const duplicate = await h.owner.request(
    `/sessions/${session.id}/duplicate`,
    "POST",
  );
  assert.equal(duplicate.status, 201);
  const originalIds = new Set(
    allBlocks(session.days[0].blocks).flatMap((block) => [
      block.id,
      ...(block.rooms ?? []).map((room) => room.id),
    ]),
  );
  assert.equal(
    allBlocks(duplicate.body.session.days[0].blocks).some(
      (block) =>
        originalIds.has(block.id) ||
        block.rooms?.some((room) => originalIds.has(room.id)),
    ),
    false,
  );
  const linear = saved.body.session as Session;
  linear.days[0].blocks = [group];
  const edited = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session: linear,
    version: linear.version,
  });
  assert.equal(edited.status, 200);
  const run = await h.owner.request(`/sessions/${session.id}/run`, "POST", {
    action: "start",
    blockId: group.id,
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.session.run.blockId, child.id);
  const removed = run.body.session as Session;
  removed.days[0].blocks[0].children = [];
  assert.equal(
    (
      await h.owner.request(`/sessions/${session.id}`, "PUT", {
        session: removed,
        version: removed.version,
      })
    ).body.code,
    "ACTIVE_BLOCK_REMOVED",
  );
});

test("milestones, planned start and explicit duration restoration work through the API", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  session.timezone = "UTC";
  session.days[0].date = new Date().toISOString().slice(0, 10);
  session.days[0].startTime = "00:00";
  session.days[0].blocks[0].duration = 0;
  const saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const start = await h.owner.request(`/sessions/${session.id}/run`, "POST", {
    action: "start",
    startMode: "planned",
    revision: saved.body.session.run.revision,
  });
  assert.equal(start.status, 200, JSON.stringify(start.body));
  assert.ok(start.body.session.run.startedAt < Date.now());
  const extension = await h.owner.request(
    `/sessions/${session.id}/run`,
    "POST",
    {
      action: "extend",
      seconds: 60,
      revision: start.body.session.run.revision,
    },
  );
  assert.equal(extension.status, 200);
  assert.equal(extension.body.session.days[0].blocks[0].duration, 1);
  const stop = await h.owner.request(`/sessions/${session.id}/run`, "POST", {
    action: "stop",
    revision: extension.body.session.run.revision,
  });
  assert.equal(stop.status, 200);
  assert.ok(
    stop.body.session.run.actualDurations[session.days[0].blocks[0].id] >= 0,
  );
  const restore = await h.owner.request(`/sessions/${session.id}/run`, "POST", {
    action: "restore-plan",
    revision: stop.body.session.run.revision,
  });
  assert.equal(restore.status, 200, JSON.stringify(restore.body));
  assert.equal(restore.body.session.days[0].blocks[0].duration, 0);
  const actual = await h.owner.request(`/sessions/${session.id}/run`, "POST", {
    action: "apply-actual",
    revision: restore.body.session.run.revision,
  });
  assert.equal(actual.status, 200, JSON.stringify(actual.body));
  assert.ok(actual.body.session.days[0].blocks[0].duration > 0);
});
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
async function stop(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
async function harness(t: TestContext, config: AppConfig = {}) {
  const postgresUrl = config.databaseUrl ?? process.env.TEST_DATABASE_URL;
  let isolatedDatabaseUrl: string | undefined;
  let schemaPool: Pool | undefined;
  const testSchema = `meetloom_test_${randomUUID().replaceAll("-", "")}`;
  if (postgresUrl) {
    schemaPool = new Pool({ connectionString: postgresUrl, max: 1 });
    // A unique generated schema lets the same behavioral suite exercise PostgreSQL
    // without modifying existing application tables or other concurrent test runs.
    await schemaPool.query(`CREATE SCHEMA "${testSchema}"`);
    const url = new URL(postgresUrl);
    url.searchParams.set("options", `-c search_path=${testSchema}`);
    isolatedDatabaseUrl = url.href;
  }
  const cleanupSchema = async () => {
    if (schemaPool) {
      try {
        await schemaPool.query(`DROP SCHEMA "${testSchema}" CASCADE`);
      } finally {
        await schemaPool.end();
      }
    }
  };
  let runtime: Awaited<ReturnType<typeof createApp>>;
  try {
    runtime = await createApp({
      sqlitePath: ":memory:",
      origin,
      rateLimits: false,
      ...config,
      databaseUrl: isolatedDatabaseUrl,
    });
  } catch (error) {
    await cleanupSchema();
    throw error;
  }
  const server = createServer(runtime.app);
  const base = await listen(server);
  t.after(async () => {
    try {
      await stop(server);
      await runtime.close();
    } finally {
      await cleanupSchema();
    }
  });
  function client() {
    let cookie = "";
    return {
      async request(
        path: string,
        method = "GET",
        body?: unknown,
        override: Record<string, string | null> = {},
      ) {
        const headers: Record<string, string> = {
          Origin: origin,
          "Content-Type": "application/json",
          ...(cookie ? { Cookie: cookie } : {}),
        };
        for (const [key, value] of Object.entries(override)) {
          if (value === null) delete headers[key];
          else headers[key] = value;
        }
        const response = await fetch(`${base}/api${path}`, {
          method,
          headers,
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const setCookie = response.headers.get("set-cookie");
        if (setCookie) cookie = setCookie.split(";")[0];
        return {
          status: response.status,
          body: (await response.json()) as any,
          headers: response.headers,
        };
      },
    };
  }
  const owner = client();
  async function setup() {
    const result = await owner.request("/auth/setup", "POST", {
      name: "Owner",
      email: "owner@example.test",
      password,
      locale: "fr",
      bootstrapToken: config.bootstrapToken,
    });
    assert.equal(result.status, 201, JSON.stringify(result.body));
    return result.body.user;
  }
  async function account(email: string) {
    const invited = await owner.request("/auth/invites", "POST", {
      name: email,
      email,
    });
    assert.equal(invited.status, 201);
    const guest = client();
    const accepted = await guest.request("/auth/accept-invite", "POST", {
      name: email,
      token: invited.body.token,
      password,
      locale: "en",
    });
    assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
    return { client: guest, user: accepted.body.user };
  }
  async function session() {
    const created = await owner.request("/sessions", "POST", {
      title: "Workshop",
      locale: "fr",
      demo: true,
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    return created.body.session as Session;
  }
  return { ...runtime, client, owner, setup, account, session };
}

test("setup is atomic; passwords and cookie tokens are never stored in plaintext", async (t) => {
  const h = await harness(t, { bootstrapToken: "deployment-key" });
  assert.equal((await h.owner.request("/auth/status")).body.needsSetup, true);
  assert.equal(
    (
      await h.owner.request("/auth/setup", "POST", {
        name: "Admin",
        email: "a@test.example",
        password,
        locale: "fr",
      })
    ).status,
    403,
  );
  const a = h.client();
  const b = h.client();
  const attempts = await Promise.all(
    [a, b].map((client, index) =>
      client.request("/auth/setup", "POST", {
        name: "Admin",
        email: `admin${index}@example.test`,
        password,
        bootstrapToken: "deployment-key",
      }),
    ),
  );
  assert.deepEqual(attempts.map((result) => result.status).sort(), [201, 409]);
  const success = attempts.find((result) => result.status === 201)!;
  assert.equal(success.body.user.isAdmin, true);
  assert.equal("password" in success.body.user, false);
  assert.match(success.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(success.headers.get("set-cookie")!, /SameSite=Strict/);
  const stored = await h.db.all<{ password: string }>(
    "SELECT password FROM users",
  );
  assert.equal(stored.length, 1);
  assert.match(stored[0].password, /^scrypt:/);
  assert.ok(!stored[0].password.includes(password));
  const sessions = await h.db.all<{ token_hash: string }>(
    "SELECT token_hash FROM auth_sessions",
  );
  assert.match(sessions[0].token_hash, /^[0-9a-f]{64}$/);
  assert.ok(
    !success.headers.get("set-cookie")!.includes(sessions[0].token_hash),
  );
});

test("authentication, logout, expiration and CSRF checks fail closed", async (t) => {
  const h = await harness(t);
  await h.setup();
  const anonymous = h.client();
  assert.equal((await anonymous.request("/sessions")).status, 401);
  assert.equal(
    (
      await anonymous.request("/auth/login", "POST", {
        email: "owner@example.test",
        password: "wrong",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await h.owner.request(
        "/sessions",
        "POST",
        { title: "Bad origin" },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await h.owner.request(
        "/sessions",
        "POST",
        { title: "Missing origin" },
        { Origin: null },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await h.owner.request(
        "/sessions",
        "POST",
        { title: "Cross site" },
        { "Sec-Fetch-Site": "cross-site" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await h.owner.request(
        "/sessions",
        "POST",
        { title: "Form post" },
        { "Content-Type": "text/plain" },
      )
    ).status,
    415,
  );
  await h.owner.request("/auth/logout", "POST", {});
  assert.equal((await h.owner.request("/sessions")).status, 401);
  assert.equal(
    (
      await h.owner.request("/auth/login", "POST", {
        email: "OWNER@example.test",
        password,
      })
    ).status,
    200,
  );
  await h.db.run("UPDATE auth_sessions SET expires_at = $1", [Date.now() - 1]);
  assert.equal((await h.owner.request("/sessions")).status, 401);
});

test("canonical origin cannot be replaced by proxy headers and secure cookies are host-bound", async (t) => {
  const canonical = "https://meetloom.example.test";
  const h = await harness(t, {
    origin: canonical,
    trustProxy: 1,
    secureCookie: true,
  });
  const body = { name: "Owner", email: "owner@example.test", password };
  const forged = {
    Origin: "https://hostile.example.test",
    "X-Forwarded-Host": "hostile.example.test",
    "X-Forwarded-Proto": "https",
  };
  assert.equal(
    (await h.owner.request("/auth/setup", "POST", body, forged)).status,
    403,
  );
  assert.equal(
    (
      await h.owner.request("/auth/setup", "POST", body, {
        Origin: canonical + ".hostile.test",
      })
    ).status,
    403,
  );
  const valid = await h.owner.request("/auth/setup", "POST", body, {
    Origin: canonical,
    "X-Forwarded-Proto": "https",
    "X-Forwarded-Host": "hostile.example.test",
  });
  assert.equal(valid.status, 201);
  const cookie = valid.headers.get("set-cookie")!;
  assert.match(cookie, /^__Host-meetloom_session=/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; Path=\//);
  assert.doesNotMatch(cookie, /Domain=/i);
});

test("environment validation rejects silent cookie downgrades and invalid production origins", () => {
  assert.throws(() => readConfig({ NODE_ENV: "production" }), /APP_ORIGIN/);
  assert.throws(
    () => readConfig({ APP_ORIGIN: "https://user:secret@example.test/" }),
    /APP_ORIGIN/,
  );
  assert.throws(
    () => readConfig({ APP_ORIGIN: "https://example.test/subpath" }),
    /APP_ORIGIN/,
  );
  assert.throws(() => readConfig({ COOKIE_SECURE: "True" }), /COOKIE_SECURE/);
  assert.throws(() => readConfig({ TRUST_PROXY: "true" }), /TRUST_PROXY/);
  const result = readConfig({
    NODE_ENV: "production",
    APP_ORIGIN: "https://example.test/",
    BOOTSTRAP_TOKEN: "   ",
  });
  assert.equal(result.app.origin, "https://example.test");
  assert.equal(result.app.secureCookie, true);
  assert.equal(result.app.bootstrapToken, undefined);
});

test("legacy password hashes upgrade on a successful login", async (t) => {
  const h = await harness(t);
  await h.setup();
  const salt = "0123456789abcdef0123456789abcdef";
  const legacy = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  await h.db.run("UPDATE users SET password = $1 WHERE email = $2", [
    legacy,
    "owner@example.test",
  ]);
  assert.equal(
    (
      await h.owner.request("/auth/login", "POST", {
        email: "owner@example.test",
        password,
      })
    ).status,
    200,
  );
  const [row] = await h.db.all<{ password: string }>(
    "SELECT password FROM users WHERE email = $1",
    ["owner@example.test"],
  );
  assert.match(row.password, /^scrypt:16384:8:5:/);
});

test("password changes rotate the current cookie and revoke every other device for that user", async (t) => {
  const h = await harness(t);
  const owner = await h.setup();
  const otherUser = await h.account("another@example.test");
  const secondDevice = h.client();
  const thirdDevice = h.client();
  const login = { email: "owner@example.test", password };
  const previous = await h.owner.request("/auth/login", "POST", login);
  const oldCookie = previous.headers.get("set-cookie")!.split(";")[0];
  await secondDevice.request("/auth/login", "POST", login);
  await thirdDevice.request("/auth/login", "POST", login);
  const previousTokens = await h.db.all<{ token_hash: string }>(
    "SELECT token_hash FROM auth_sessions WHERE user_id = $1",
    [owner.id],
  );
  const newPassword = "new-correct-password-456";
  const changed = await h.owner.request("/auth/password", "POST", {
    currentPassword: password,
    newPassword,
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.deepEqual(changed.body.user, owner);
  assert.equal("password" in changed.body.user, false);
  assert.notEqual(changed.headers.get("set-cookie")!.split(";")[0], oldCookie);
  assert.match(changed.headers.get("set-cookie")!, /HttpOnly/);
  assert.match(changed.headers.get("set-cookie")!, /SameSite=Strict/);
  const remainingTokens = await h.db.all<{ token_hash: string }>(
    "SELECT token_hash FROM auth_sessions WHERE user_id = $1",
    [owner.id],
  );
  assert.equal(remainingTokens.length, 1);
  assert.ok(
    previousTokens.every(
      (item) => item.token_hash !== remainingTokens[0].token_hash,
    ),
  );
  assert.equal((await h.owner.request("/sessions")).status, 200);
  assert.equal((await secondDevice.request("/sessions")).status, 401);
  assert.equal((await thirdDevice.request("/sessions")).status, 401);
  assert.equal(
    (
      await h
        .client()
        .request("/sessions", "GET", undefined, { Cookie: oldCookie })
    ).status,
    401,
  );
  assert.equal((await otherUser.client.request("/sessions")).status, 200);
  assert.equal(
    (await h.client().request("/auth/login", "POST", login)).status,
    401,
  );
  assert.equal(
    (
      await h
        .client()
        .request("/auth/login", "POST", { ...login, password: newPassword })
    ).status,
    200,
  );
});

test("password changes require authentication, the current password and a valid new password", async (t) => {
  const h = await harness(t);
  await h.setup();
  const body = {
    currentPassword: password,
    newPassword: "new-correct-password-456",
  };
  const [before] = await h.db.all<{ password: string }>(
    "SELECT password FROM users",
  );
  assert.equal(
    (await h.client().request("/auth/password", "POST", body)).status,
    401,
  );
  const wrong = await h.owner.request("/auth/password", "POST", {
    ...body,
    currentPassword: "wrong",
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.code, "INVALID_CREDENTIALS");
  for (const newPassword of ["short", "a".repeat(257)]) {
    assert.equal(
      (
        await h.owner.request("/auth/password", "POST", {
          ...body,
          newPassword,
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await h.owner.request("/auth/password", "POST", {
        newPassword: body.newPassword,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.owner.request("/auth/password", "POST", body, {
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  assert.deepEqual((await h.db.all("SELECT password FROM users"))[0], before);
  assert.equal((await h.owner.request("/sessions")).status, 200);
});

test("password changes accept legacy hashes and write the current KDF format", async (t) => {
  const h = await harness(t);
  await h.setup();
  const salt = "0123456789abcdef0123456789abcdef";
  const legacy = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  await h.db.run("UPDATE users SET password = $1", [legacy]);
  const newPassword = "new-correct-password-456";
  assert.equal(
    (
      await h.owner.request("/auth/password", "POST", {
        currentPassword: password,
        newPassword,
      })
    ).status,
    200,
  );
  const [row] = await h.db.all<{ password: string }>(
    "SELECT password FROM users",
  );
  assert.match(row.password, /^scrypt:16384:8:5:/);
  assert.ok(!row.password.includes(newPassword));
  assert.equal(
    (
      await h.client().request("/auth/login", "POST", {
        email: "owner@example.test",
        password: newPassword,
      })
    ).status,
    200,
  );
});

test("concurrent password changes cannot overwrite a newer password or keep a stale cookie", async (t) => {
  const h = await harness(t);
  const owner = await h.setup();
  const otherDevice = h.client();
  await otherDevice.request("/auth/login", "POST", {
    email: "owner@example.test",
    password,
  });
  const choices = ["concurrent-password-one", "concurrent-password-two"];
  const clients = [h.owner, otherDevice];
  const results = await Promise.all(
    clients.map((client, index) =>
      client.request("/auth/password", "POST", {
        currentPassword: password,
        newPassword: choices[index],
      }),
    ),
  );
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  const winner = results.findIndex((result) => result.status === 200);
  assert.ok([401, 409].includes(results[1 - winner].status));
  assert.equal((await clients[winner].request("/sessions")).status, 200);
  assert.equal((await clients[1 - winner].request("/sessions")).status, 401);
  assert.equal(
    (
      await h.db.all(
        "SELECT token_hash FROM auth_sessions WHERE user_id = $1",
        [owner.id],
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await h.client().request("/auth/login", "POST", {
        email: "owner@example.test",
        password: choices[winner],
      })
    ).status,
    200,
  );
});

test("an in-flight login using the old password cannot recreate a revoked session", async (t) => {
  const h = await harness(t);
  await h.setup();
  const originalAll = h.db.all.bind(h.db);
  let readCompleted!: () => void;
  let releaseRead!: () => void;
  const read = new Promise<void>((resolve) => {
    readCompleted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  h.db.all = async <T>(query: string, values?: unknown[]) => {
    const rows = await originalAll<T>(query, values);
    if (query.startsWith("SELECT * FROM users WHERE email = $1")) {
      readCompleted();
      await released;
    }
    return rows;
  };
  const login = h
    .client()
    .request("/auth/login", "POST", { email: "owner@example.test", password });
  try {
    await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Login read hook was not reached")),
          5000,
        );
        timeout.unref();
      }),
    ]);
    assert.equal(
      (
        await h.owner.request("/auth/password", "POST", {
          currentPassword: password,
          newPassword: "new-correct-password-456",
        })
      ).status,
      200,
    );
  } finally {
    releaseRead();
    h.db.all = originalAll;
  }
  assert.equal((await login).status, 401);
  assert.equal(
    (await h.db.all("SELECT token_hash FROM auth_sessions")).length,
    1,
  );
});

test("password-change attempts share the bounded authentication rate limiter", async (t) => {
  const h = await harness(t, { rateLimits: true });
  await h.setup(); // Uses the first of twenty authentication attempts.
  for (let index = 0; index < 19; index++) {
    assert.equal(
      (
        await h.owner.request("/auth/password", "POST", {
          currentPassword: password,
          newPassword: "short",
        })
      ).status,
      400,
    );
  }
  const limited = await h.owner.request("/auth/password", "POST", {
    currentPassword: password,
    newPassword: "new-correct-password-456",
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.code, "RATE_LIMITED");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  assert.equal((await h.owner.request("/sessions")).status, 200);
});

test("invitations are admin-only, expiring, single use and never create administrators", async (t) => {
  const h = await harness(t);
  await h.setup();
  const invited = await h.owner.request("/auth/invites", "POST", {
    name: "Guest",
    email: "guest@example.test",
  });
  const guest = h.client();
  const accepted = await guest.request("/auth/accept-invite", "POST", {
    token: invited.body.token,
    name: "Guest",
    password,
  });
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.user.isAdmin, false);
  assert.equal(
    (
      await h.client().request("/auth/accept-invite", "POST", {
        token: invited.body.token,
        name: "Guest",
        password,
      })
    ).status,
    410,
  );
  assert.equal(
    (
      await guest.request("/auth/invites", "POST", {
        name: "Other",
        email: "other@example.test",
      })
    ).status,
    403,
  );
  const expiring = await h.owner.request("/auth/invites", "POST", {
    name: "Expired",
    email: "expired@example.test",
  });
  await h.db.run("UPDATE invites SET expires_at = $1", [Date.now() - 1]);
  assert.equal(
    (
      await h.client().request("/auth/accept-invite", "POST", {
        token: expiring.body.token,
        name: "Expired",
        password,
      })
    ).status,
    410,
  );
});

test("concurrent invitation acceptance creates one account and existing accounts cannot be replaced", async (t) => {
  const h = await harness(t);
  await h.setup();
  const invited = await h.owner.request("/auth/invites", "POST", {
    name: "Guest",
    email: "guest@example.test",
  });
  const attempts = await Promise.all(
    [h.client(), h.client()].map((client) =>
      client.request("/auth/accept-invite", "POST", {
        token: invited.body.token,
        name: "Guest",
        password,
      }),
    ),
  );
  assert.deepEqual(
    attempts.map((attempt) => attempt.status).sort(),
    [201, 410],
  );
  assert.equal(
    (
      await h.db.all("SELECT id FROM users WHERE email = $1", [
        "guest@example.test",
      ])
    ).length,
    1,
  );
  assert.equal(
    (
      await h.owner.request("/auth/invites", "POST", {
        name: "Another",
        email: "guest@example.test",
      })
    ).status,
    409,
  );
  const [admin] = await h.db.all<{ id: string; password: string }>(
    "SELECT id,password FROM users WHERE email = $1",
    ["owner@example.test"],
  );
  assert.equal(
    (
      await h.client().request("/auth/accept-invite", "POST", {
        token: invited.body.token,
        name: "Replacement",
        email: "owner@example.test",
        password: "different-password-123",
      })
    ).status,
    410,
  );
  const [unchanged] = await h.db.all<{ id: string; password: string }>(
    "SELECT id,password FROM users WHERE email = $1",
    ["owner@example.test"],
  );
  assert.deepEqual(unchanged, admin);
});

test("nested resource IDs cannot cross sessions even when the caller owns both", async (t) => {
  const h = await harness(t);
  await h.setup();
  const first = await h.session();
  const second = await h.session();
  const firstPath = `/sessions/${first.id}`;
  const secondPath = `/sessions/${second.id}`;
  const share = (
    await h.owner.request(firstPath + "/shares", "POST", {
      label: "First session",
    })
  ).body.share;
  assert.equal(
    (await h.owner.request(secondPath + `/shares/${share.id}`, "DELETE", {}))
      .status,
    404,
  );
  assert.equal(
    (await h.client().request(`/public/${share.token}`)).status,
    200,
  );
  await h.owner.request(firstPath, "PUT", {
    session: { ...first, title: "Changed" },
    version: first.version,
  });
  const version = (await h.owner.request(firstPath + "/versions")).body
    .versions[0];
  assert.equal(
    (
      await h.owner.request(
        secondPath + `/versions/${version.id}/restore`,
        "POST",
        { version: second.version },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await h.owner.request(secondPath + "/comments", "POST", {
        blockId: first.days[0].blocks[0].id,
        text: "Misplaced",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.owner.request(secondPath + "/run", "POST", {
        action: "start",
        dayId: second.days[0].id,
        blockId: first.days[0].blocks[0].id,
      })
    ).status,
    400,
  );
});

test("session membership isolates unrelated accounts and separates editor/facilitator/viewer permissions", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  const path = `/sessions/${session.id}`;
  const unrelated = await h.account("unrelated@example.test");
  assert.equal((await unrelated.client.request(path)).status, 404);
  assert.deepEqual(
    (await unrelated.client.request("/sessions")).body.sessions,
    [],
  );
  for (const suffix of ["/members", "/comments", "/versions", "/shares"])
    assert.equal((await unrelated.client.request(path + suffix)).status, 404);
  for (const role of ["editor", "facilitator", "viewer"] as const) {
    const member = await h.account(`${role}@example.test`);
    assert.equal(
      (
        await h.owner.request(path + "/members", "POST", {
          email: member.user.email,
          role,
        })
      ).status,
      201,
    );
    const loaded = await member.client.request(path);
    assert.equal(loaded.body.role, role);
    assert.equal(
      (
        await member.client.request(path + "/shares", "POST", {
          label: "Cannot share",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await member.client.request(path + "/members", "POST", {
          email: unrelated.user.email,
          role: "editor",
        })
      ).status,
      403,
    );
    const edited = await member.client.request(path, "PUT", {
      session: loaded.body.session,
      version: loaded.body.session.version,
    });
    assert.equal(edited.status, role === "editor" ? 200 : 403);
    const started = await member.client.request(path + "/run", "POST", {
      action: "start",
      dayId: session.days[0].id,
      blockId: session.days[0].blocks[0].id,
    });
    assert.equal(started.status, role === "viewer" ? 403 : 200);
    await h.owner.request(path + "/run", "POST", { action: "reset" });
  }
  await h.owner.request(path + "/members", "DELETE", {}); // unknown route is a JSON 404
  assert.equal(
    (await h.owner.request(path + "/members/not-a-member", "DELETE", {}))
      .status,
    404,
  );
});

test("concurrent writes use compare-and-swap and cannot forge ownership or running state", async (t) => {
  const h = await harness(t);
  const owner = await h.setup();
  const session = await h.session();
  const path = `/sessions/${session.id}`;
  const forged = {
    ...session,
    title: "New title",
    ownerId: "someone-else",
    id: "different",
    version: 999,
    run: { ...session.run, status: "running" },
  };
  const writes = await Promise.all([
    h.owner.request(path, "PUT", { session: forged, version: session.version }),
    h.owner.request(path, "PUT", {
      session: { ...session, title: "Other title" },
      version: session.version,
    }),
  ]);
  assert.deepEqual(writes.map((result) => result.status).sort(), [200, 409]);
  const current = (await h.owner.request(path)).body.session;
  assert.equal(current.id, session.id);
  assert.equal(current.ownerId, owner.id);
  assert.equal(current.run.status, "idle");
  assert.equal(current.version, session.version + 1);
});

test("anonymous shares whitelist fields server-side, expire and revoke; tokens are returned only once", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  session.columns = session.columns.map((column) =>
    column.id === "description" || column.id === "facilitator"
      ? { ...column, visibility: "team" }
      : column,
  );
  session.columns.push({
    id: "handout",
    label: "Visible guidance",
    visibility: "public",
    visible: true,
  });
  session.days[0].blocks[0].fields.notes = "PRIVATE_PROMPTER_TEXT";
  session.days[0].blocks[0].description = "PRIVATE_DESCRIPTION";
  session.days[0].blocks[0].facilitator = "PRIVATE_PERSON";
  session.days[0].blocks[0].fields.handout = "PUBLIC_INSTRUCTION";
  const path = `/sessions/${session.id}`;
  assert.equal(
    (await h.owner.request(path, "PUT", { session, version: session.version }))
      .status,
    200,
  );
  const created = await h.owner.request(path + "/shares", "POST", {
    label: "Visitors",
  });
  assert.equal(created.status, 201);
  const share = created.body.share;
  const publicResponse = await h.client().request(`/public/${share.token}`);
  assert.equal(publicResponse.status, 200);
  const serialized = JSON.stringify(publicResponse.body);
  for (const secret of [
    "PRIVATE_PROMPTER_TEXT",
    "PRIVATE_DESCRIPTION",
    "PRIVATE_PERSON",
    "ownerId",
    "sound",
    "Notes de présentation",
  ])
    assert.ok(!serialized.includes(secret), secret);
  assert.ok(serialized.includes("PUBLIC_INSTRUCTION"));
  assert.equal(publicResponse.headers.get("cache-control"), "no-store");
  assert.equal(
    (await h.owner.request(path + "/shares")).body.shares[0].token,
    undefined,
  );
  const stored = await h.db.all<{ token_hash: string }>(
    "SELECT token_hash FROM shares",
  );
  assert.ok(!JSON.stringify(stored).includes(share.token));
  await h.owner.request(path + `/shares/${share.id}`, "DELETE", {});
  assert.equal(
    (await h.client().request(`/public/${share.token}`)).status,
    404,
  );
  const expiring = (
    await h.owner.request(path + "/shares", "POST", {
      label: "Expires",
      expiresAt: new Date(Date.now() + 10000).toISOString(),
    })
  ).body.share;
  await h.db.run("UPDATE shares SET expires_at = $1 WHERE id = $2", [
    new Date(Date.now() - 1).toISOString(),
    expiring.id,
  ]);
  assert.equal(
    (await h.client().request(`/public/${expiring.token}`)).status,
    404,
  );
});

test("membership removal immediately revokes access, including mutations", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  const member = await h.account("editor@example.test");
  const path = `/sessions/${session.id}`;
  await h.owner.request(path + "/members", "POST", {
    email: member.user.email,
    role: "editor",
  });
  assert.equal((await member.client.request(path)).status, 200);
  await h.owner.request(path + `/members/${member.user.id}`, "DELETE", {});
  assert.equal((await member.client.request(path)).status, 404);
  assert.equal(
    (
      await member.client.request(path, "PUT", {
        session,
        version: session.version,
      })
    ).status,
    404,
  );
});

test("timer revision conflicts, private API access and active-block deletion are enforced", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  const path = `/sessions/${session.id}`;
  const running = await h.owner.request(path + "/run", "POST", {
    action: "start",
    dayId: session.days[0].id,
    blockId: session.days[0].blocks[0].id,
    revision: 0,
  });
  assert.equal(running.status, 200);
  assert.equal(running.body.session.run.status, "running");
  assert.equal(
    (
      await h.owner.request(path + "/run", "POST", {
        action: "pause",
        revision: 0,
      })
    ).status,
    409,
  );
  assert.equal(
    (await h.client().request(path + "/run", "POST", { action: "pause" }))
      .status,
    401,
  );
  const deleted = structuredClone(running.body.session);
  deleted.days[0].blocks.shift();
  assert.equal(
    (
      await h.owner.request(path, "PUT", {
        session: deleted,
        version: deleted.version,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.owner.request(path + "/run", "POST", {
        action: "pause",
        revision: running.body.session.run.revision,
      })
    ).body.session.run.status,
    "paused",
  );
  assert.equal(
    (await h.owner.request(path + "/run", "POST", { action: "finish" })).body
      .session.run.status,
    "finished",
  );
  const empty = (
    await h.owner.request("/sessions", "POST", { title: "Empty agenda" })
  ).body.session;
  assert.equal(
    (
      await h.owner.request(`/sessions/${empty.id}/run`, "POST", {
        action: "start",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.owner.request(path + "/run", "POST", {
        action: "extend",
        seconds: -60,
      })
    ).status,
    400,
  );
});

test("versions restore agendas with a stopped timer and a new revision; duplicates do not copy access links", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  const path = `/sessions/${session.id}`;
  const updated = await h.owner.request(path, "PUT", {
    session: { ...session, title: "Changed title" },
    version: session.version,
  });
  const versions = (await h.owner.request(path + "/versions")).body.versions;
  assert.equal(versions.length, 1);
  const restored = await h.owner.request(
    path + `/versions/${versions[0].id}/restore`,
    "POST",
    { version: updated.body.session.version },
  );
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  assert.equal(restored.body.session.title, session.title);
  assert.equal(restored.body.session.run.status, "idle");
  assert.equal(restored.body.session.version, session.version + 2);
  await h.owner.request(path + "/shares", "POST", { label: "Original" });
  const duplicate = (await h.owner.request(path + "/duplicate", "POST", {}))
    .body.session;
  assert.notEqual(duplicate.id, session.id);
  assert.deepEqual(
    (await h.owner.request(`/sessions/${duplicate.id}/shares`)).body.shares,
    [],
  );
  assert.deepEqual(
    (await h.owner.request(`/sessions/${duplicate.id}/versions`)).body.versions,
    [],
  );
  const titled = await h.owner.request(`/sessions/${duplicate.id}`, "PUT", {
    session: { ...duplicate, title: "x".repeat(240) },
    version: duplicate.version,
  });
  const redoubled = (
    await h.owner.request(`/sessions/${duplicate.id}/duplicate`, "POST", {})
  ).body.session;
  assert.equal(titled.status, 200);
  assert.equal(redoubled.title.length, 240);
  assert.equal(
    (
      await h.owner.request(`/sessions/${redoubled.id}`, "PUT", {
        session: redoubled,
        version: redoubled.version,
      })
    ).status,
    200,
  );
});

test("comments require valid block references and never leak through public routes", async (t) => {
  const h = await harness(t);
  const owner = await h.setup();
  const session = await h.session();
  const path = `/sessions/${session.id}`;
  assert.equal(
    (
      await h.owner.request(path + "/comments", "POST", {
        blockId: "missing",
        text: "A comment",
      })
    ).status,
    400,
  );
  const posted = await h.owner.request(path + "/comments", "POST", {
    blockId: session.days[0].blocks[0].id,
    text: "TEAM_COMMENT_SECRET",
  });
  assert.equal(posted.status, 201);
  assert.equal(
    (await h.owner.request(path + "/comments")).body.comments[0].author,
    "Owner",
  );
  const share = (
    await h.owner.request(path + "/shares", "POST", { label: "Visitor" })
  ).body.share;
  assert.ok(
    !JSON.stringify(
      (await h.client().request(`/public/${share.token}`)).body,
    ).includes("TEAM_COMMENT_SECRET"),
  );
  await h.db.transaction(async (sql) => {
    for (let index = 0; index < 51; index++) {
      await sql.run(
        "INSERT INTO comments(id,session_id,block_id,user_id,text,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [
          `seed-${index}`,
          session.id,
          null,
          owner.id,
          `Old comment ${index}`,
          new Date(Date.UTC(2000, 0, 1) + index * 1000).toISOString(),
        ],
      );
      await sql.run(
        "INSERT INTO comment_threads(id,session_id,updated_at) VALUES($1,$2,$3)",
        [
          `seed-${index}`,
          session.id,
          new Date(Date.UTC(2000, 0, 1) + index * 1000).toISOString(),
        ],
      );
      await sql.run(
        "INSERT INTO comment_context(comment_id,thread_id,parent_id,mention_ids) VALUES($1,$1,NULL,'[]')",
        [`seed-${index}`],
      );
    }
  });
  const retained = (await h.owner.request(path + "/comments")).body.comments;
  assert.equal(retained.length, 20);
  assert.ok(
    retained.some(
      (comment: { text: string }) => comment.text === "TEAM_COMMENT_SECRET",
    ),
  );
  assert.ok(
    !retained.some((comment: { id: string }) => comment.id === "seed-0"),
  );
  const older = (await h.owner.request(path + "/comments?offset=40")).body;
  assert.equal(older.comments.length, 12);
  assert.equal(older.hasMore, false);
  assert.ok(
    older.comments.some((comment: { id: string }) => comment.id === "seed-0"),
  );
});

test("validation rejects malformed/oversized inputs without exposing stack traces", async (t) => {
  const h = await harness(t);
  await h.setup();
  assert.equal(
    (await h.owner.request("/sessions", "POST", { title: "" })).status,
    400,
  );
  const session = await h.session();
  session.days[0].blocks[0].duration = -1;
  const invalid = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.stack, undefined);
  assert.equal(
    (await h.owner.request("/sessions", "POST", { title: "x".repeat(1100000) }))
      .status,
    413,
  );
  assert.equal((await h.client().request("/health")).status, 200);
  assert.equal((await h.client().request("/ready")).status, 200);
});

test("AI is opt-in and never silently calls an external default provider", async (t) => {
  const h = await harness(t);
  await h.setup();
  assert.equal((await h.owner.request("/auth/status")).body.aiEnabled, false);
  const response = await h.owner.request("/ai/generate", "POST", {
    prompt: "Create a planning workshop",
    duration: 30,
    locale: "fr",
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.code, "AI_DISABLED");
});

test("workspace sound defaults require admin and apply only to newly created agendas", async (t) => {
  const h = await harness(t);
  await h.setup();
  const existing = await h.session();
  const member = await h.account("member@example.test");
  const sound = {
    enabled: true,
    mode: "percent",
    value: 20,
    atEnd: false,
    volume: 0.8,
    sound: "digital",
  };
  assert.equal((await h.client().request("/settings")).status, 401);
  assert.equal(
    (await member.client.request("/settings", "PUT", { sound })).status,
    403,
  );
  assert.equal(
    (await h.owner.request("/settings", "PUT", { sound })).status,
    200,
  );
  assert.deepEqual(
    (await member.client.request("/settings")).body.sound,
    sound,
  );
  assert.deepEqual((await h.session()).sound, sound);
  assert.deepEqual(
    (await h.owner.request(`/sessions/${existing.id}`)).body.session.sound,
    existing.sound,
  );
});

test("AI adapter validates model output, bounds responses and leaves agendas unchanged", async (t) => {
  let content = JSON.stringify({
    blocks: [
      {
        title: "Discuss",
        description: "Discuss our objective",
        duration: 30,
        category: "discussion",
      },
    ],
  });
  const provider = createServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  const providerBase = await listen(provider);
  t.after(() => stop(provider));
  const h = await harness(t, {
    ai: {
      baseUrl: `${providerBase}/v1`,
      model: "internal-qwen",
      maxResponseBytes: 2000,
    },
  });
  await h.setup();
  const session = await h.session();
  const generated = await h.owner.request("/ai/generate", "POST", {
    prompt: "Create a planning workshop",
    duration: 30,
    locale: "en",
  });
  assert.equal(generated.status, 200, JSON.stringify(generated.body));
  assert.equal(generated.body.blocks[0].duration, 30);
  assert.deepEqual(generated.body.blocks[0].fields, {});
  assert.equal(
    (await h.owner.request(`/sessions/${session.id}`)).body.session.version,
    session.version,
  );
  content = JSON.stringify({ blocks: [{ title: "Invalid", duration: -100 }] });
  assert.equal(
    (
      await h.owner.request("/ai/generate", "POST", {
        prompt: "Create a planning workshop",
        duration: 30,
      })
    ).status,
    502,
  );
  content = "x".repeat(3000);
  const oversized = await h.owner.request("/ai/generate", "POST", {
    prompt: "Create a planning workshop",
    duration: 30,
  });
  assert.equal(oversized.status, 502);
  assert.equal(oversized.body.code, "AI_RESPONSE_LIMIT");
});
