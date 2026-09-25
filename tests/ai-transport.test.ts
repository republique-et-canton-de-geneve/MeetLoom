import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { listen, stop } from "./support.js";
import { complete } from "../server/ai.js";
import { HttpError } from "../server/security.js";

function captureWarnings(t: TestContext) {
  const lines: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(
      args
        .map((value) =>
          typeof value === "string" ? value : JSON.stringify(value),
        )
        .join(" "),
    );
  };
  t.after(() => {
    console.warn = original;
  });
  return lines;
}

const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => assert.fail("expected a failure"),
    (error: unknown) => (error as HttpError).code,
  );

test("an unreachable LLM is reported as unavailable, with the network cause in the logs", async (t) => {
  const warnings = captureWarnings(t);
  // A closed port fails like an unknown certificate authority does
  // (SELF_SIGNED_CERT_IN_CHAIN): fetch rejects before any answer.
  const closed = createServer();
  const baseUrl = await listen(closed);
  await stop(closed);
  assert.equal(
    await failure(complete({ baseUrl, model: "m" }, "s", "p", false)),
    "AI_UNAVAILABLE",
  );
  assert.match(warnings.join("\n"), /AI service unreachable: ECONNREFUSED/);
});

test("an unusable answer says why in the logs, without its content", async (t) => {
  const warnings = captureWarnings(t);
  const replies = [
    { status: 200, type: "text/html", body: "<!doctype html>Private page" },
    { status: 404, type: "application/json", body: '{"error":"no model"}' },
    {
      status: 200,
      type: "application/json",
      body: JSON.stringify({ choices: [{ message: { content: "" } }] }),
    },
  ];
  const server = createServer(async (request, response) => {
    for await (const _ of request);
    const reply = replies.shift()!;
    response.statusCode = reply.status;
    response.setHeader("Content-Type", reply.type);
    response.end(reply.body);
  });
  const baseUrl = await listen(server);
  t.after(() => stop(server));
  const config = { baseUrl, model: "m" };
  assert.equal(
    await failure(complete(config, "s", "p", false)),
    "AI_RESPONSE_INVALID",
  );
  assert.equal(
    await failure(complete(config, "s", "p", false)),
    "AI_UNAVAILABLE",
  );
  assert.equal(
    await failure(complete(config, "s", "p", false)),
    "AI_RESPONSE_INVALID",
  );
  const log = warnings.join("\n");
  assert.match(log, /not a chat completion.*text\/html/);
  assert.match(log, /HTTP 404/);
  assert.equal(log.includes("Private page"), false);
});

test("an LLM with a self-signed certificate is refused unless explicitly allowed", async (t) => {
  const warnings = captureWarnings(t);
  const { createServer: createHttpsServer } = await import("node:https");
  const { readFileSync } = await import("node:fs");
  const server = createHttpsServer(
    {
      key: readFileSync("tests/fixtures/self-signed.key"),
      cert: readFileSync("tests/fixtures/self-signed.crt"),
    },
    async (request, response) => {
      for await (const _ of request);
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ choices: [{ message: { content: "Bonjour" } }] }),
      );
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const { port } = server.address() as { port: number };
  const baseUrl = `https://127.0.0.1:${port}/v1`;
  assert.equal(
    await failure(complete({ baseUrl, model: "m" }, "s", "p", false)),
    "AI_UNAVAILABLE",
  );
  assert.match(warnings.join("\n"), /AI service unreachable: \w*SELF_SIGNED/);
  assert.equal(
    await complete(
      { baseUrl, model: "m", allowSelfSigned: true },
      "s",
      "p",
      false,
    ),
    "Bonjour",
  );
});
