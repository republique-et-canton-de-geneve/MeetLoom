import test from "node:test";
import assert from "node:assert/strict";
import {
  allBlocks,
  createSession,
  newBlock,
  publicProjection,
  transitionRun,
} from "../shared/domain.js";
import { mergeImportedAgenda } from "../src/import.js";
import { sessionInputSchema } from "../shared/validation.js";
import {
  contentIds,
  newForm,
  newPage,
  newQuestion,
} from "../shared/content.js";

function incoming() {
  const source = createSession("source-owner", "Source", "fr");
  source.columns.forEach((column) => {
    column.visibility = "team";
  });
  source.days[0].blocks = [
    newBlock("fr", {
      title: "Imported activity",
      description: "SECRET_DESCRIPTION",
      facilitator: "SECRET_PERSON",
      fields: { notes: "SECRET_NOTES" },
    }),
  ];
  return source;
}

test("import keeps private notes and private built-in values out of public destination fields", () => {
  const destination = createSession(
    "destination-owner",
    "Destination",
    "fr",
    true,
  );
  const source = incoming();
  const beforeDestination = JSON.stringify(destination),
    beforeSource = JSON.stringify(source);
  const result = mergeImportedAgenda(destination, source);
  const block = result.days.at(-1)!.blocks[0];
  assert.equal(block.description, "");
  assert.equal(block.facilitator, "");
  assert.deepEqual(Object.values(block.fields).sort(), [
    "SECRET_DESCRIPTION",
    "SECRET_NOTES",
    "SECRET_PERSON",
  ]);
  assert.equal(
    JSON.stringify(publicProjection(result)).includes("SECRET"),
    false,
  );
  assert.equal(
    result.columns
      .slice(destination.columns.length)
      .every((column) => column.visibility === "team"),
    true,
  );
  assert.equal(result.ownerId, destination.ownerId);
  assert.equal(result.id, destination.id);
  assert.equal(JSON.stringify(destination), beforeDestination);
  assert.equal(JSON.stringify(source), beforeSource);
  assert.deepEqual(result.days[0], destination.days[0]);
});

test("a missing source built-in column is private by default", () => {
  const destination = createSession("owner", "Destination", "en");
  const source = incoming();
  source.columns = source.columns.filter(
    (column) => !["description", "facilitator"].includes(column.id),
  );
  const result = mergeImportedAgenda(destination, source);
  assert.equal(
    JSON.stringify(publicProjection(result)).includes("SECRET"),
    false,
  );
  assert.equal(result.days.at(-1)!.blocks[0].description, "");
});

test("public source built-ins stay built-in and do not broaden a private destination audience", () => {
  const destination = createSession("owner", "Destination", "en");
  destination.columns.forEach((column) => {
    column.visibility = "team";
  });
  const source = incoming();
  source.columns.forEach((column) => {
    column.visibility = "public";
  });
  const result = mergeImportedAgenda(destination, source);
  assert.equal(result.days.at(-1)!.blocks[0].description, "SECRET_DESCRIPTION");
  assert.equal(result.days.at(-1)!.blocks[0].facilitator, "SECRET_PERSON");
  assert.equal(
    JSON.stringify(publicProjection(result)).includes("SECRET"),
    false,
  );
  assert.equal(
    result.columns.length,
    destination.columns.length +
      source.columns.filter(
        (column) => !["description", "facilitator"].includes(column.id),
      ).length,
    "only non-built-in source columns need new identifiers, including empty configured fields",
  );
  assert.deepEqual(
    result.columns
      .slice(destination.columns.length)
      .map((column) => column.label),
    source.columns
      .filter((column) => !["description", "facilitator"].includes(column.id))
      .map((column) => column.label),
  );
});

test("import remaps every source identifier and preserves the running destination baseline", () => {
  const destination = transitionRun(
    createSession("owner", "Destination", "fr", true),
    "start",
    {},
    1000,
  );
  const result = mergeImportedAgenda(destination, destination);
  const ids = [
    ...result.columns.map((column) => column.id),
    ...result.days.flatMap((day) => [
      day.id,
      ...day.blocks.map((block) => block.id),
    ]),
  ];
  assert.equal(ids.length, new Set(ids).size);
  assert.notEqual(result.days[0].id, result.days[1].id);
  assert.notEqual(result.days[0].blocks[0].id, result.days[1].blocks[0].id);
  assert.deepEqual(result.run, destination.run);
  assert.equal(result.version, destination.version);
});

test("import refuses cumulative day, block and column limits without mutating the destination", () => {
  const source = incoming();
  const columns = createSession("owner", "Destination", "fr");
  columns.columns.push(
    ...Array.from({ length: 19 - columns.columns.length }, (_, i) => ({
      id: `custom-${i}`,
      label: `Column ${i}`,
      visibility: "team" as const,
      visible: true,
    })),
  );
  assert.equal(
    sessionInputSchema.safeParse(columns).success,
    true,
    "the destination itself must be valid before testing the cumulative limit",
  );
  const beforeColumns = JSON.stringify(columns);
  assert.throws(() => mergeImportedAgenda(columns, source), /20 columns/);
  assert.equal(JSON.stringify(columns), beforeColumns);
  const days = createSession("owner", "Destination", "fr");
  days.days = Array.from({ length: 30 }, (_, i) => ({
    ...days.days[0],
    id: `day-${i}`,
    blocks: [],
  }));
  days.run.dayId = days.days[0].id;
  assert.throws(() => mergeImportedAgenda(days, source), /30 days/);
  const blocks = createSession("owner", "Destination", "fr");
  blocks.days[0].blocks = Array.from({ length: 1000 }, () => newBlock("fr"));
  const before = JSON.stringify(blocks);
  assert.throws(() => mergeImportedAgenda(blocks, source), /1000 blocks/);
  assert.equal(JSON.stringify(blocks), before);
});

test("import remaps nested groups and room IDs while keeping all source preparation fields private", () => {
  const source = incoming();
  source.columns.find((column) => column.id === "notes")!.kind = "tasks";
  const child = source.days[0].blocks[0];
  source.days[0].blocks = [
    newBlock("fr", {
      kind: "group",
      children: [
        newBlock("fr", {
          kind: "parallel",
          rooms: [{ id: "source-room", title: "Room", blocks: [child] }],
        }),
      ],
    }),
  ];
  const destination = createSession("owner", "Destination", "fr");
  const result = mergeImportedAgenda(destination, source);
  const imported = allBlocks(result.days.at(-1)!.blocks);
  const original = allBlocks(source.days[0].blocks);
  assert.equal(imported.length, original.length);
  for (const block of imported)
    assert.equal(
      original.some((prior) => prior.id === block.id),
      false,
    );
  assert.notEqual(imported[1].rooms![0].id, "source-room");
  assert.equal(
    JSON.stringify(publicProjection(result)).includes("SECRET"),
    false,
  );
  assert.equal(
    result.columns.find(
      (column) => column.id !== "notes" && column.kind === "tasks",
    )?.visibility,
    "team",
  );
  assert.equal(
    Object.values(imported[2].fields).includes("SECRET_DESCRIPTION"),
    true,
  );
});

test("import remaps custom categories including collisions with destination categories", () => {
  const destination = createSession("owner", "Destination", "fr");
  destination.categories = [
    { id: "custom-category", label: "Destination", color: "#123456" },
  ];
  const source = incoming();
  source.categories = [
    { id: "custom-category", label: "Source", color: "#654321" },
  ];
  source.days[0].blocks[0].category = "custom-category";
  const result = mergeImportedAgenda(destination, source);
  const importedCategory = result.categories!.at(-1)!;
  assert.notEqual(importedCategory.id, "custom-category");
  assert.equal(importedCategory.color, "#654321");
  assert.equal(result.days.at(-1)!.blocks[0].category, importedCategory.id);
  assert.equal(result.categories![0].id, "custom-category");
});

test("import remaps pages, forms, questions and navigation and makes imported pages internal", () => {
  const source = incoming(),
    destination = createSession("owner", "Destination", "en");
  const page = newPage("en"),
    form = newForm("en");
  page.visibility = "public";
  page.sections[0].content = "SECRET_IMPORTED_PAGE";
  form.questions = [newQuestion("matrix", "en")];
  source.pages = [page];
  source.forms = [form];
  source.contentOrder = [
    { kind: "page", id: page.id },
    { kind: "form", id: form.id },
    { kind: "day", id: source.days[0].id },
  ];
  const result = mergeImportedAgenda(destination, source);
  assert.equal(result.pages![0].visibility, "team");
  assert.equal(
    contentIds(result).some((id) => contentIds(source).includes(id)),
    false,
  );
  assert.equal(
    JSON.stringify(publicProjection(result)).includes("SECRET_IMPORTED_PAGE"),
    false,
  );
  assert.deepEqual(
    result.contentOrder?.map((item) => item.kind),
    ["day", "page", "form", "day"],
  );
});
