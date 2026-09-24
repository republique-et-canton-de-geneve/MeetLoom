import test from "node:test";
import assert from "node:assert/strict";
import { createSession, newBlock } from "../shared/domain.js";
import { appendTask, serializeRichText } from "../shared/richtext.js";
import { assistAgenda } from "../server/ai.js";

test("AI context reads rich descriptions and nested activities without metadata or private auxiliary fields", async (t) => {
  const session = createSession("SECRET_OWNER", "Agenda", "fr");
  session.description = serializeRichText({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Session purpose", marks: [{ type: "bold" }] },
        ],
      },
    ],
  });
  session.days[0].blocks = [
    newBlock("fr", {
      kind: "group",
      children: [
        newBlock("fr", {
          title: "Nested activity",
          description: appendTask("", "Review objective"),
          facilitator: "SECRET_PERSON",
          fields: { notes: "SECRET_NOTES" },
          duration: 25,
        }),
      ],
    }),
  ];
  let sent = "";
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      sent = String(init.body);
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "Advice" } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  );
  const result = await assistAgenda(
    { baseUrl: "http://internal-model.example/v1" },
    session,
    { prompt: "Improve the agenda", locale: "en" },
  );
  assert.equal(result, "Advice");
  assert.equal(sent.includes("Session purpose"), true);
  assert.equal(sent.includes("Nested activity"), true);
  assert.equal(sent.includes("[ ] Review objective"), true);
  assert.equal(sent.includes("meetloom:richtext"), false);
  assert.equal(sent.includes("SECRET"), false);
});
