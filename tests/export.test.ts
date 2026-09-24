import test from "node:test";
import assert from "node:assert/strict";
import { createSession, newBlock, publicProjection } from "../shared/domain.js";
import { csvCell, exportSessionCsv, exportSessionJson } from "../src/export.js";
import { appendTask, serializeRichText } from "../shared/richtext.js";

test("CSV quotes and neutralizes formulas including disguised leading whitespace", () => {
  for (const value of [
    "=1+1",
    "+1+1",
    "-1+1",
    "@SUM(A1)",
    "\tSUM(A1)",
    "\rSUM(A1)",
    "\n=1",
    "  =1+1",
    "\uFEFF=1",
  ]) {
    assert.equal(csvCell(value).startsWith("\"'"), true, value);
  }
  assert.equal(csvCell('Plain "quote", text'), '"Plain ""quote"", text"');
  assert.equal(csvCell("Several\nlines"), '"Several\nlines"');
});

test("CSV flattens nested room content with safe plain text and preserves room timing", () => {
  const session = createSession("owner", "Nested", "en");
  session.days[0].startTime = "09:00";
  const richFormula = serializeRichText({
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: '=WEBSERVICE("https://untrusted")',
            marks: [{ type: "bold" }],
          },
        ],
      },
    ],
  });
  session.days[0].blocks = [
    newBlock("en", {
      title: "Parallel",
      kind: "parallel",
      rooms: [
        {
          id: "room-a",
          title: "Room A",
          blocks: [
            newBlock("en", {
              title: "Nested activity",
              duration: 20,
              description: richFormula,
              fields: { notes: appendTask("", "SECRET_TASK") },
            }),
          ],
        },
        {
          id: "room-b",
          title: "Room B",
          blocks: [newBlock("en", { duration: 30 })],
        },
      ],
    }),
  ];
  const csv = exportSessionCsv(publicProjection(session), "en");
  assert.match(csv, /Nested activity/);
  assert.match(csv, /Room A/);
  assert.match(csv, /"09:00","09:20","20"/);
  assert.match(csv, /"'=WEBSERVICE/);
  assert.equal(csv.includes("meetloom:richtext"), false);
  assert.equal(csv.includes("SECRET_TASK"), false);
});

test("public CSV and JSON export only authorized columns, regardless of editor visibility", () => {
  const session = createSession("owner", "Export", "fr");
  session.columns[1].visibility = "team";
  session.columns[0].visible = false;
  session.days[0].blocks = [
    newBlock("fr", {
      title: '=WEBSERVICE("untrusted")',
      description: "Visible description",
      facilitator: "SECRET_PERSON",
      fields: { notes: "SECRET_NOTES" },
    }),
  ];
  const projected = publicProjection(session);
  Object.assign(projected.days[0].blocks[0], { unexpected: "SECRET_UNKNOWN" });
  const csv = exportSessionCsv(projected);
  assert.equal(csv.startsWith("\uFEFF"), true);
  assert.equal(csv.includes("Visible description"), true);
  assert.equal(csv.includes("SECRET"), false);
  assert.equal(csv.includes("\"'=WEBSERVICE("), true);
  assert.equal(exportSessionJson(projected).includes("SECRET"), false);
  assert.equal(
    exportSessionCsv(session).includes("SECRET_NOTES"),
    true,
    "authenticated organizer backup includes team columns",
  );
});
