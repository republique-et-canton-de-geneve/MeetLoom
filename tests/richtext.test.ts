import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "../src/RichText.js";
import {
  RICH_TEXT_PREFIX,
  appendMaterial,
  appendTask,
  extractMaterials,
  extractTasks,
  parseRichText,
  richTextToPlain,
  safeLink,
  sanitizeRichDocument,
  serializeRichText,
  setTaskChecked,
} from "../shared/richtext.js";

test("rich text preserves formatting, safe links and literal text without rendering arbitrary HTML", () => {
  const value = serializeRichText({
    type: "doc",
    content: [
      {
        type: "paragraph",
        attrs: { onclick: "alert(1)" },
        content: [
          {
            type: "text",
            text: "<img src=x onerror=alert(1)>",
            marks: [
              { type: "bold" },
              {
                type: "link",
                attrs: { href: "javascript:alert(1)", onclick: "unsafe" },
              },
            ],
          },
          {
            type: "text",
            text: "Documentation",
            marks: [
              {
                type: "link",
                attrs: { href: "https://example.org/help", target: "_self" },
              },
            ],
          },
        ],
      },
    ],
  });
  const html = renderToStaticMarkup(createElement(RichText, { value }));
  assert.match(html, /<strong>&lt;img/);
  assert.match(html, /href="https:\/\/example.org\/help"/);
  assert.match(html, /rel="noopener noreferrer nofollow"/);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("javascript:"), false);
  assert.equal(html.includes("onclick="), false);
  assert.equal(
    richTextToPlain(value),
    "<img src=x onerror=alert(1)>Documentation",
  );
  assert.match(
    renderToStaticMarkup(
      createElement(RichText, { value: "<script>alert(1)</script>" }),
    ),
    /&lt;script&gt;/,
  );
});

test("untrusted rich text rejects executable URLs, unknown nodes, illegal structure and excessive depth", () => {
  for (const link of [
    "javascript:alert(1)",
    "data:text/html,x",
    "//example.org",
    "https://user:password@example.org",
    "https://example.org/\nunsafe",
  ])
    assert.equal(safeLink(link), undefined);
  assert.equal(
    safeLink("mailto:hello@example.org"),
    "mailto:hello@example.org",
  );
  assert.equal(
    sanitizeRichDocument({
      type: "doc",
      content: [{ type: "image", attrs: { src: "evil" } }],
    }),
    null,
  );
  assert.equal(
    sanitizeRichDocument({
      type: "doc",
      content: [{ type: "text", text: "invalid block" }],
    }),
    null,
  );
  let child: unknown = { type: "paragraph" };
  for (let i = 0; i < 25; i++) child = { type: "blockquote", content: [child] };
  assert.equal(sanitizeRichDocument({ type: "doc", content: [child] }), null);
  assert.equal(parseRichText(RICH_TEXT_PREFIX + "{broken"), null);
  assert.throws(
    () =>
      serializeRichText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x".repeat(30000) }],
          },
        ],
      }),
    /limit/,
  );
});

test("task toggles preserve other formatting and nested task paths without mutating input", () => {
  const initial = appendTask(
    appendTask("Preparation", "Book the room"),
    "Print handouts",
  );
  const tasks = extractTasks(initial);
  assert.deepEqual(
    tasks.map((task) => [task.text, task.checked]),
    [
      ["Book the room", false],
      ["Print handouts", false],
    ],
  );
  const next = setTaskChecked(initial, tasks[1].path, true);
  assert.deepEqual(
    extractTasks(next).map((task) => task.checked),
    [false, true],
  );
  assert.equal(extractTasks(initial)[1].checked, false);
  assert.match(richTextToPlain(next), /\[x\] Print handouts/);
  assert.throws(() => setTaskChecked(initial, [0], true), /changed/);
  const nested = serializeRichText({
    type: "doc",
    content: [
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "Parent" }],
              },
              {
                type: "taskList",
                content: [
                  {
                    type: "taskItem",
                    content: [
                      {
                        type: "paragraph",
                        content: [{ type: "text", text: "Child" }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
  assert.deepEqual(
    extractTasks(nested).map((task) => task.text),
    ["Parent", "Child"],
  );
});

test("materials support legacy plain lines and rich lists with no duplicate nested entries", () => {
  assert.deepEqual(extractMaterials("- Pens\n2. Paper\n  • Board"), [
    "Pens",
    "Paper",
    "Board",
  ]);
  const value = appendMaterial(appendMaterial("", "Pens"), "Paper");
  assert.deepEqual(extractMaterials(value), ["Pens", "Paper"]);
  assert.equal(richTextToPlain(value).trim(), "Pens\nPaper");
});
