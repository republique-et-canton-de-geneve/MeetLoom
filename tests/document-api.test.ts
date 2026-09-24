import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { harness, listen, stop } from "./support.js";
test("document API requires auth, extracts without persistence and keeps AI opt-in", async (t) => {
  const h = await harness(t);
  await h.setup();
  const input = {
    name: "programme.txt",
    base64: Buffer.from("Accueil\nVote").toString("base64"),
  };
  assert.equal(
    (await h.client().request("/import/extract", "POST", input)).status,
    401,
  );
  const extraction = await h.owner.request("/import/extract", "POST", input);
  assert.equal(extraction.status, 200, JSON.stringify(extraction.body));
  assert.equal(extraction.body.document.text, "Accueil\nVote");
  assert.equal(
    (
      await h.owner.request("/import/agenda", "POST", {
        text: "Agenda",
        name: "Programme",
        locale: "fr",
      })
    ).body.code,
    "AI_DISABLED",
  );
  assert.equal(
    (
      await h.owner.request("/import/extract", "POST", {
        name: "x.png",
        base64: "iVBORw0KGgo=",
      })
    ).body.code,
    "AI_VISION_DISABLED",
  );
  assert.equal((await h.owner.request("/sessions")).body.sessions.length, 0);
});
test("AI import returns a validated private preview and image OCR uses configured internal vision model only", async (t) => {
  let received: any;
  let text = "";
  const provider = createServer(async (req, res) => {
    let body = "";
    for await (const part of req) body += part;
    received = JSON.parse(body);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: text } }] }));
  });
  const baseUrl = await listen(provider);
  t.after(() => stop(provider));
  const h = await harness(t, {
    ai: { baseUrl, model: "text-model", visionModel: "vision-model" },
  });
  await h.setup();
  text = JSON.stringify({
    title: "Atelier",
    blocks: [
      {
        title: "Débat",
        description: "Notes confidentielles",
        duration: 25,
        category: "discussion",
        facilitator: "Alice",
        section: "",
      },
    ],
  });
  const preview = await h.owner.request("/import/agenda", "POST", {
    text: "Source atelier",
    name: "Source",
    locale: "fr",
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.session.days[0].blocks[0].duration, 25);
  assert.ok(
    preview.body.session.columns.every(
      (column: any) => column.visibility === "team",
    ),
  );
  assert.equal((await h.owner.request("/sessions")).body.sessions.length, 0);
  text = "Visible heading";
  const ocr = await h.owner.request("/import/extract", "POST", {
    name: "x.png",
    base64: "iVBORw0KGgo=",
  });
  assert.equal(ocr.status, 200, JSON.stringify(ocr.body));
  assert.equal(received.model, "vision-model");
  assert.equal(
    received.messages.at(-1).content[1].image_url.url,
    "data:image/png;base64,iVBORw0KGgo=",
  );
  assert.equal(ocr.body.document.text, "Visible heading");
  text = JSON.stringify({
    title: "Bad",
    blocks: [{ title: "x", duration: -1 }],
  });
  assert.equal(
    (
      await h.owner.request("/import/agenda", "POST", {
        text: "x",
        name: "x",
        locale: "fr",
      })
    ).body.code,
    "AI_IMPORT_INVALID",
  );
});
