import test from "node:test";
import assert from "node:assert/strict";
import { parseInline, parseMarkdown } from "../shared/markdown-lite.js";

test("model answers become headings, lists and emphasis, never markup", () => {
  const blocks = parseMarkdown(
    [
      "## Réponse",
      "La note moyenne est **4 sur 5** (1 réponse).",
      "",
      "**Thèmes récurrents :**",
      "* Plus de *pratique*",
      "   1. Ateliers courts",
      "* Pauses",
      "suite de la ligne",
      "",
      "---",
      "<script>alert(1)</script>",
    ].join("\n"),
  );
  assert.deepEqual(
    blocks.map((block) => block.type),
    ["heading", "paragraph", "paragraph", "list", "paragraph"],
  );
  assert.deepEqual(blocks[0], {
    type: "heading",
    level: 2,
    inline: [{ text: "Réponse" }],
  });
  assert.deepEqual(blocks[1], {
    type: "paragraph",
    lines: [
      [
        { text: "La note moyenne est " },
        { text: "4 sur 5", bold: true },
        { text: " (1 réponse)." },
      ],
    ],
  });
  const list = blocks[3];
  assert.equal(list.type, "list");
  if (list.type !== "list") return;
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[0].inline, [
    { text: "Plus de " },
    { text: "pratique", italic: true },
  ]);
  assert.equal(list.items[0].children[0].ordered, true);
  assert.deepEqual(list.items[1].inline, [
    { text: "Pauses" },
    { text: " " },
    { text: "suite de la ligne" },
  ]);
  // Anything else stays literal text, rendered as text.
  assert.deepEqual(blocks[4], {
    type: "paragraph",
    lines: [[{ text: "<script>alert(1)</script>" }]],
  });
});

test("asterisks inside words or arithmetic stay text", () => {
  assert.deepEqual(parseInline("2 * 3 * 4 = 24"), [{ text: "2 * 3 * 4 = 24" }]);
  assert.deepEqual(parseInline("snake_case_name"), [
    { text: "snake_case_name" },
  ]);
  assert.deepEqual(parseInline("`a*b*c`"), [{ text: "a*b*c", code: true }]);
});
