import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import express, { type Express } from "express";
import { rateLimit } from "../server/security.js";

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
