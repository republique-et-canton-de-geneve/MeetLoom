import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { harness, listen, stop } from "./support.js";
import { DEFAULT_PRINT_OPTIONS } from "../shared/export-settings.js";

test("export AI only sees selected audience data and returns a reviewed bounded proposal", async (t) => {
  let received = "",
    answer: unknown = {
      answer: "More readable",
      options: { fontSize: 14 },
      outline: [],
    };
  const provider = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    received = body;
    res.setHeader("Content-Type", "application/json");
    res.end(
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
  const session = await h.session(),
    stranger = await h.account("export-stranger@example.test");
  session.days[0].blocks[0].fields.notes = "EXPORT_PRIVATE_SENTINEL";
  const saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const path = `/sessions/${session.id}/export/ai`,
    input = {
      mode: "settings",
      prompt: "Make this legible",
      locale: "en",
      options: { ...DEFAULT_PRINT_OPTIONS, paper: "Legal", landscape: true },
      selection: {
        audience: "public",
        dayIds: session.days.map((day) => day.id),
        columnIds: session.columns.map((column) => column.id),
        landscape: true,
      },
    };
  assert.equal((await h.client().request(path, "POST", input)).status, 401);
  assert.equal(
    (await stranger.client.request(path, "POST", input)).status,
    404,
  );
  const result = await h.owner.request(path, "POST", input);
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.options.fontSize, 14);
  assert.equal(result.body.options.paper, "Legal");
  assert.equal(result.body.options.landscape, true);
  assert.ok(!received.includes("EXPORT_PRIVATE_SENTINEL"));
  assert.equal(
    (await h.owner.request(`/sessions/${session.id}`)).body.session.version,
    saved.body.session.version,
  );
  answer = {
    answer: "Outline",
    options: {},
    outline: [
      {
        id: `block-${session.days[0].blocks[0].id}`,
        title: "A clearer title",
        enabled: true,
      },
    ],
  };
  const outline = await h.owner.request(path, "POST", {
    ...input,
    mode: "slides",
    selection: { ...input.selection, audience: "team" },
  });
  assert.equal(outline.status, 200, JSON.stringify(outline.body));
  assert.equal(outline.body.outline[0].targetId, session.days[0].blocks[0].id);
  assert.ok(received.includes("EXPORT_PRIVATE_SENTINEL"));
  answer = {
    answer: "Unknown",
    options: {},
    outline: [{ id: "unknown", title: "Unsafe", enabled: true }],
  };
  assert.equal(
    (await h.owner.request(path, "POST", { ...input, mode: "slides" })).status,
    502,
  );
  answer = { answer: "Invalid", options: { font: "Remote font" }, outline: [] };
  assert.equal((await h.owner.request(path, "POST", input)).status, 502);
});
