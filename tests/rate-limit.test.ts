import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import express, { type Express, type RequestHandler } from "express";
import { MemoryStore } from "express-rate-limit";
import { rateLimit, withRateLimitStores } from "../server/security.js";
import { createApp } from "../server/app.js";
import { origin } from "./support.js";

async function serve(t: TestContext, configure: (app: Express) => void) {
  const app = express();
  // Only this fixture's actual loopback peer can supply a forwarded client IP.
  app.set("trust proxy", (address: string) => address === "127.0.0.1");
  configure(app);
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/limited`;
  return async (headers: Record<string, string> = {}) => {
    const response = await fetch(url, { headers });
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
}

test("exceeding the request budget returns a JSON 429 and a usable Retry-After", async (t) => {
  const request = await serve(t, (app) => {
    app.get("/limited", rateLimit(2, 10000), (_req, res) => {
      res.json({ accepted: true });
    });
  });
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 200);
  const denied = await request();
  assert.equal(denied.status, 429);
  assert.equal(denied.body.code, "RATE_LIMITED");
  assert.equal(typeof denied.body.error, "string");
  assert.match(denied.headers.get("content-type") ?? "", /application\/json/);
  const retryAfter = denied.headers.get("retry-after");
  assert.match(retryAfter ?? "", /^[1-9]\d*$/);
  assert.ok(Number(retryAfter) <= 10);
});

test("rotating IPv6 addresses inside a subnet shares its budget, while a different subnet remains available", async (t) => {
  const request = await serve(t, (app) => {
    app.get("/limited", rateLimit(2, 10000), (_req, res) => {
      res.json({ accepted: true });
    });
  });
  const first = "2001:db8:1234:5600::1";
  const second = "2001:db8:1234:5600::abcd";
  const third = "2001:db8:1234:5600::ffff";
  assert.equal((await request({ "X-Forwarded-For": first })).status, 200);
  assert.equal((await request({ "X-Forwarded-For": second })).status, 200);
  const denied = await request({ "X-Forwarded-For": third });
  assert.equal(denied.status, 429);
  assert.equal(denied.body.code, "RATE_LIMITED");
  assert.equal(
    (await request({ "X-Forwarded-For": "2001:db8:1235:5600::1" })).status,
    200,
  );
  // An attacker-controlled earlier proxy header cannot replace the closest
  // untrusted client address selected by Express's narrow trust configuration.
  assert.equal(
    (
      await request({
        "X-Forwarded-For": `2001:db8:ffff::1, ${third}`,
      })
    ).status,
    429,
  );
});

test("an authenticated account key isolates users sharing one IP and follows the account across IP changes", async (t) => {
  const request = await serve(t, (app) => {
    app.use((req, res, next) => {
      // Stand-in for authentication performed before the limiter; no account DB
      // or application routes are needed to exercise this middleware contract.
      res.locals.account = req.get("X-Fixture-Account");
      next();
    });
    app.get(
      "/limited",
      rateLimit(1, 10000, (_req, res) => `account:${res.locals.account}`),
      (_req, res) => res.json({ accepted: true }),
    );
  });
  assert.equal((await request({ "X-Fixture-Account": "alice" })).status, 200);
  assert.equal((await request({ "X-Fixture-Account": "alice" })).status, 429);
  assert.equal((await request({ "X-Fixture-Account": "bob" })).status, 200);
  assert.equal(
    (
      await request({
        "X-Fixture-Account": "alice",
        "X-Forwarded-For": "192.0.2.25",
      })
    ).status,
    429,
  );
});

test("a limited client can make requests again after the short window expires", async (t) => {
  const request = await serve(t, (app) => {
    app.get("/limited", rateLimit(1, 500), (_req, res) => {
      res.json({ accepted: true });
    });
  });
  assert.equal((await request()).status, 200);
  const denied = await request();
  assert.equal(denied.status, 429);
  assert.equal(denied.headers.get("retry-after"), "1");
  await delay(650);
  assert.equal((await request()).status, 200);
  assert.equal((await request()).status, 429);
});

test("closing one application releases only the limiter budgets it assembled", async (t) => {
  const assemble = () =>
    withRateLimitStores(async () => {
      // Yield between limiters so concurrent assemblies interleave.
      await delay(1);
      return rateLimit(1, 10000);
    });
  const [first, second] = await Promise.all([assemble(), assemble()]);
  const outside = rateLimit(1, 10000);
  t.after(() => second.shutdown());
  const route = (limiter: RequestHandler) => (app: Express) =>
    app.get("/limited", limiter, (_req, res) => res.json({ accepted: true }));
  const requestFirst = await serve(t, route(first.result));
  const requestSecond = await serve(t, route(second.result));
  const requestOutside = await serve(t, route(outside));
  for (const request of [requestFirst, requestSecond, requestOutside]) {
    assert.equal((await request()).status, 200);
    assert.equal((await request()).status, 429);
  }
  first.shutdown();
  assert.equal((await requestFirst()).status, 200);
  assert.equal((await requestSecond()).status, 429);
  assert.equal((await requestOutside()).status, 429);
});

test("a failed assembly releases the limiters it had already created", async (t) => {
  const shutdown = t.mock.method(MemoryStore.prototype, "shutdown");
  await assert.rejects(
    withRateLimitStores(async () => {
      rateLimit(1, 10000);
      rateLimit(1, 10000);
      throw new Error("assembly failed");
    }),
    /assembly failed/,
  );
  assert.equal(shutdown.mock.callCount(), 2);
});

test("closing the application shuts down every limiter store it created", async (t) => {
  const init = t.mock.method(MemoryStore.prototype, "init");
  const shutdown = t.mock.method(MemoryStore.prototype, "shutdown");
  const runtime = await createApp({
    sqlitePath: ":memory:",
    origin,
    rateLimits: true,
  });
  assert.ok(init.mock.callCount() > 0);
  assert.equal(shutdown.mock.callCount(), 0);
  await runtime.close();
  assert.equal(shutdown.mock.callCount(), init.mock.callCount());
});

test("a room of visitors behind one address keeps following a public link", async (t) => {
  // 700 polls in a minute from one address: about 230 attendees behind a
  // meeting-room NAT, each refreshing the visitor page every three seconds.
  const { harness } = await import("./support.js");
  const h = await harness(t, { rateLimits: true, trustProxy: 1 });
  await h.setup();
  const session = await h.session();
  const share = await h.owner.request(
    `/sessions/${session.id}/shares`,
    "POST",
    {
      label: "Room",
    },
  );
  const room = h.client();
  const statuses = new Set<number>();
  for (let index = 0; index < 700; index++)
    statuses.add(
      (
        await room.request(
          `/public/${share.body.share.token}`,
          "GET",
          undefined,
          {
            "X-Forwarded-For": "203.0.113.10",
          },
        )
      ).status,
    );
  assert.deepEqual([...statuses], [200]);
});

test("signed-in requests are budgeted per account, not per address", async (t) => {
  const { harness } = await import("./support.js");
  const h = await harness(t, {
    rateLimits: true,
    trustProxy: 1,
    requestBudget: { perAddress: 10_000, perUser: 5 },
  });
  await h.setup();
  const other = await h.account("other@example.test");
  // setup and account creation used the owner's budget; move addresses to
  // show that changing IP does not reset an account's budget.
  const statuses: number[] = [];
  for (let index = 0; index < 8; index++)
    statuses.push(
      (
        await h.owner.request("/sessions", "GET", undefined, {
          "X-Forwarded-For": `198.51.100.${index + 1}`,
        })
      ).status,
    );
  assert.ok(statuses.includes(429), JSON.stringify(statuses));
  assert.equal(
    (
      await other.client.request("/sessions", "GET", undefined, {
        "X-Forwarded-For": "198.51.100.1",
      })
    ).status,
    200,
    "another account behind the same address keeps its own budget",
  );
});
