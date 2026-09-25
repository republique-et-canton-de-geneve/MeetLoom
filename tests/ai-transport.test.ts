import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { listen, stop } from "./support.js";
import { complete } from "../server/ai.js";
import { HttpError } from "../server/security.js";

/** A provider answering each request with the next canned response. */
async function provider(
  t: TestContext,
  replies: { status?: number; type?: string; body: string }[],
) {
  const requests: Record<string, unknown>[] = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const part of request) body += part;
    requests.push(JSON.parse(body));
    const reply = replies.shift()!;
    response.statusCode = reply.status ?? 200;
    response.setHeader("Content-Type", reply.type ?? "application/json");
    response.end(reply.body);
  });
  const baseUrl = await listen(server);
  t.after(() => stop(server));
  return { baseUrl, requests };
}

const chat = (message: Record<string, unknown>, finish = "stop") =>
  JSON.stringify({ choices: [{ message, finish_reason: finish }] });

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

const code = (error: unknown) => (error as HttpError).code;

test("answers from reasoning models and content parts are usable", async (t) => {
  const { baseUrl, requests } = await provider(t, [
    // Qwen3 or DeepSeek-R1 without a reasoning parser: thinking inline.
    {
      body: chat({
        content: "<think>\nLet me plan.\n</think>\n\nVoici un conseil.",
      }),
    },
    // Gateways returning OpenAI content parts.
    {
      body: chat({
        content: [
          { type: "text", text: "Premier. " },
          { type: "text", text: "Second." },
        ],
      }),
    },
    // Reasoning parser on: thinking kept apart, answer in content.
    { body: chat({ reasoning_content: "Thinking…", content: "Réponse." }) },
  ]);
  const config = { baseUrl, model: "m", maxTokens: 9000 };
  assert.equal(
    await complete(config, "system", "prompt", false),
    "Voici un conseil.",
  );
  assert.equal(
    await complete(config, "system", "prompt", false),
    "Premier. Second.",
  );
  assert.equal(await complete(config, "system", "prompt", false), "Réponse.");
  assert.equal(requests[0].max_tokens, 9000);
});

test("an unusable answer says why in the logs, without its content", async (t) => {
  const warnings = captureWarnings(t);
  const { baseUrl } = await provider(t, [
    // A reasoning model that spent its whole budget thinking.
    {
      body: chat(
        { content: null, reasoning_content: "secret thoughts" },
        "length",
      ),
    },
    // The base URL points at a web page, not the /v1 API.
    { type: "text/html", body: "<!doctype html><title>Chat UI</title>" },
    // Wrong model or key.
    {
      status: 404,
      body: JSON.stringify({ error: { message: "model not found" } }),
    },
    { body: chat({ content: "" }) },
  ]);
  const config = { baseUrl, model: "m" };
  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => assert.fail("expected a failure"),
      (error: unknown) => code(error),
    );
  assert.equal(
    await failure(complete(config, "s", "p", false)),
    "AI_RESPONSE_TRUNCATED",
  );
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
  assert.match(log, /finish_reason=length/);
  assert.match(log, /reasoning_content/);
  assert.match(log, /not JSON.*text\/html/);
  assert.match(log, /HTTP 404/);
  assert.match(log, /empty content/);
  assert.equal(log.includes("secret thoughts"), false);
  assert.equal(log.includes("Chat UI"), false);
});
