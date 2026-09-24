import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { createSession, newBlock } from "../shared/domain.js";
import {
  exportProjection,
  slideChunks,
  wordBlob,
  powerpointBlob,
  defaultSlideOutline,
} from "../src/export-documents.js";
import { serializeRichText } from "../shared/richtext.js";
import { newPage } from "../shared/content.js";
import { scheduleExportDay } from "../shared/export-projection.js";
import { clipboardTable } from "../src/export-clipboard.js";

function fixture() {
  const session = createSession("owner", "Atelier export", "fr");
  session.days[0].blocks = [
    newBlock("fr", {
      title: "Décision",
      description: serializeRichText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Texte public en gras",
                marks: [{ type: "bold" }],
              },
            ],
          },
        ],
      }),
      fields: { notes: "PRIVATE-SENTINEL-DO-NOT-EXPORT" },
    }),
  ];
  return session;
}
function entries(buffer: Buffer): Map<string, string> {
  const result = new Map<string, string>();
  // Read central directory offsets so data descriptors and compressed entries work.
  for (let at = 0; at < buffer.length - 46; at++) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) continue;
    const method = buffer.readUInt16LE(at + 10),
      size = buffer.readUInt32LE(at + 20),
      nameLength = buffer.readUInt16LE(at + 28),
      extra = buffer.readUInt16LE(at + 30),
      comment = buffer.readUInt16LE(at + 32),
      offset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString();
    const start =
      offset +
      30 +
      buffer.readUInt16LE(offset + 26) +
      buffer.readUInt16LE(offset + 28);
    const data = buffer.subarray(start, start + size);
    result.set(name, (method === 8 ? inflateRawSync(data) : data).toString());
    at += 45 + nameLength + extra + comment;
  }
  return result;
}
test("export choices are applied before serialization and cannot elevate private columns", () => {
  const session = fixture();
  const shared = exportProjection(session, {
    audience: "public",
    dayIds: [session.days[0].id],
    columnIds: ["description", "notes"],
    landscape: false,
  });
  assert.equal(JSON.stringify(shared).includes("PRIVATE-SENTINEL"), false);
  assert.equal(
    shared.columns.some((c) => c.id === "notes"),
    false,
  );
  const team = exportProjection(session, {
    audience: "team",
    dayIds: [session.days[0].id],
    columnIds: ["notes"],
    landscape: false,
  });
  assert.equal(team.days[0].blocks[0].description, undefined);
  assert.equal(
    team.days[0].blocks[0].fields.notes,
    "PRIVATE-SENTINEL-DO-NOT-EXPORT",
  );
});
test("Word and PowerPoint are valid archives containing visible content and no private values", async () => {
  const session = fixture();
  const source = exportProjection(session, {
    audience: "public",
    dayIds: [session.days[0].id],
    columnIds: session.columns.map((c) => c.id),
    landscape: false,
  });
  const word = entries(
    Buffer.from(
      await (
        await wordBlob(source, "fr", { landscape: false, audience: "public" })
      ).arrayBuffer(),
    ),
  );
  assert.match(word.get("word/document.xml")!, /Texte public en gras/);
  assert.match(word.get("word/document.xml")!, /w:b/);
  assert.equal([...word.values()].join("").includes("PRIVATE-SENTINEL"), false);
  const pptx = entries(
    Buffer.from(
      await (await powerpointBlob(source, "fr", "public")).arrayBuffer(),
    ),
  );
  assert.ok(pptx.has("ppt/presentation.xml"));
  assert.match([...pptx.values()].join(""), /Texte public en gras/);
  assert.equal([...pptx.values()].join("").includes("PRIVATE-SENTINEL"), false);
});
test("slide pagination preserves long words and all paragraph content", () => {
  const text = "Détails " + "x".repeat(1401) + "\nDernière ligne";
  const chunks = slideChunks(text, 700);
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 700));
  assert.equal(chunks.join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
});

test("team exports retain selected internal Pages, public exports remove them, and Word applies Legal paper and fonts", async () => {
  const session = fixture(),
    privatePage = newPage("fr"),
    publicPage = newPage("fr");
  privatePage.title = "Internal briefing";
  privatePage.sections[0].content = "PRIVATE_PAGE_SENTINEL";
  publicPage.title = "Public info";
  publicPage.visibility = "public";
  publicPage.sections[0].content = "PUBLIC_PAGE_CONTENT";
  session.pages = [privatePage, publicPage];
  session.columns.push({
    id: "materials",
    kind: "materials",
    label: "Matériel",
    visibility: "team",
    visible: false,
  });
  session.days[0].blocks[0].fields.materials = "Feutres internes";
  const team = exportProjection(session, {
    audience: "team",
    dayIds: session.days.map((day) => day.id),
    columnIds: session.columns.map((column) => column.id),
    pageIds: [privatePage.id],
    landscape: false,
  });
  assert.equal(team.pages?.[0].sections[0].content, "PRIVATE_PAGE_SENTINEL");
  assert.equal(team.pages?.length, 1);
  const shared = exportProjection(session, {
    audience: "public",
    dayIds: session.days.map((day) => day.id),
    columnIds: session.columns.map((column) => column.id),
    landscape: false,
  });
  assert.ok(!JSON.stringify(shared).includes("PRIVATE_PAGE_SENTINEL"));
  assert.ok(!JSON.stringify(shared).includes("Feutres internes"));
  const word = entries(
    Buffer.from(
      await (
        await wordBlob(team, "fr", {
          audience: "team",
          landscape: false,
          paper: "Legal",
          font: "Georgia",
          fontSize: 12,
          layout: "table",
          includeMaterials: true,
        })
      ).arrayBuffer(),
    ),
  );
  assert.match(word.get("word/document.xml")!, /PRIVATE_PAGE_SENTINEL/);
  assert.match(word.get("word/document.xml")!, /w:tbl/);
  assert.match(word.get("word/document.xml")!, /20160/);
  assert.match(word.get("word/styles.xml")!, /Georgia/);
  assert.match(word.get("word/document.xml")!, /Feutres internes/);
});
test("PowerPoint respects outline order, puts details in speaker notes and embeds local QR pixels", async () => {
  const session = fixture(),
    source = exportProjection(session, {
      audience: "team",
      dayIds: session.days.map((day) => day.id),
      columnIds: ["notes"],
      landscape: false,
    });
  const block = defaultSlideOutline(source, "fr").find(
    (slide) => slide.kind === "block",
  )!;
  const deck = entries(
    Buffer.from(
      await (
        await powerpointBlob(source, "fr", "team", {
          speakerNotes: true,
          outline: [
            {
              id: "form",
              kind: "form",
              title: "Feedback QR",
              enabled: true,
              url: "https://meetloom.example.test/s/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            },
            block,
          ],
        })
      ).arrayBuffer(),
    ),
  );
  assert.match(deck.get("ppt/slides/slide1.xml")!, /Feedback QR/);
  assert.ok(
    [...deck.keys()].some(
      (name) => name.startsWith("ppt/media/") && name.endsWith(".png"),
    ),
  );
  assert.ok(!deck.get("ppt/slides/slide2.xml")!.includes("PRIVATE-SENTINEL"));
  assert.ok(
    [...deck.entries()].some(
      ([name, content]) =>
        name.startsWith("ppt/notesSlides/notesSlide") &&
        content.includes("PRIVATE-SENTINEL"),
    ),
  );
});

test("filtered descendants keep their original midnight times without copying excluded group fields", () => {
  const session = fixture(),
    day = session.days[0];
  day.startTime = "23:50";
  const excluded = newBlock("fr", { title: "Excluded", duration: 20 }),
    kept = newBlock("fr", {
      title: "Kept",
      duration: 10,
      category: "decision",
    });
  day.blocks = [
    newBlock("fr", {
      kind: "group",
      title: "Group",
      description: "EXCLUDED_GROUP_DESCRIPTION",
      fields: { notes: "EXCLUDED_GROUP_NOTE" },
      children: [excluded, kept],
    }),
  ];
  const source = exportProjection(session, {
    audience: "team",
    dayIds: [day.id],
    columnIds: ["description", "notes"],
    landscape: false,
    blockIds: [kept.id],
    categoryIds: ["decision"],
  });
  assert.equal(source.days[0].blocks.length, 1);
  assert.equal(source.days[0].blocks[0].children?.length, 1);
  assert.ok(!JSON.stringify(source).includes("EXCLUDED_GROUP"));
  assert.ok(!JSON.stringify(source).includes(excluded.id));
  const row = scheduleExportDay(source, source.days[0]).find(
    (value) => value.block.id === kept.id,
  )!;
  assert.equal(row.startMinute, 1450);
  assert.equal(row.endMinute, 1460);
  assert.equal(day.blocks[0].children?.length, 2);
});

test("tabular clipboard export escapes HTML, neutralizes formulas and projects no private content", () => {
  const session = fixture();
  session.days[0].blocks[0].title = '=HYPERLINK("bad")';
  session.days[0].blocks[0].description =
    "<img src=x onerror=alert(1)>\nsecond";
  const source = exportProjection(session, {
    audience: "public",
    dayIds: session.days.map((day) => day.id),
    columnIds: session.columns.map((column) => column.id),
    landscape: false,
  });
  const table = clipboardTable(source, "en");
  assert.ok(table.text.includes("'=HYPERLINK"));
  assert.ok(table.html.includes("&#39;=HYPERLINK"));
  assert.ok(table.html.includes("&lt;img"));
  assert.ok(!table.html.includes("<img"));
  assert.ok(!table.text.includes("PRIVATE-SENTINEL"));
});

test("PowerPoint speaker notes are selectable per field", async () => {
  const session = fixture(),
    source = exportProjection(session, {
      audience: "team",
      dayIds: session.days.map((day) => day.id),
      columnIds: ["description", "notes"],
      landscape: false,
    });
  const outline = defaultSlideOutline(source, "fr").filter(
    (slide) => slide.kind === "block",
  );
  const deck = entries(
    Buffer.from(
      await (
        await powerpointBlob(source, "fr", "team", {
          speakerNotes: true,
          noteColumnIds: ["notes"],
          outline,
        })
      ).arrayBuffer(),
    ),
  );
  const slides = [...deck.entries()]
    .filter(([name]) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .map(([, value]) => value)
    .join("");
  const notes = [...deck.entries()]
    .filter(([name]) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(name))
    .map(([, value]) => value)
    .join("");
  assert.ok(slides.includes("Texte public en gras"));
  assert.ok(!slides.includes("PRIVATE-SENTINEL"));
  assert.ok(notes.includes("PRIVATE-SENTINEL"));
  assert.ok(!notes.includes("Texte public en gras"));
});
