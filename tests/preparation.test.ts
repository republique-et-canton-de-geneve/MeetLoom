import test from "node:test";
import assert from "node:assert/strict";
import { createSession, newBlock, publicProjection } from "../shared/domain.js";
import { appendTask, extractTasks } from "../shared/richtext.js";
import {
  addPreparationItem,
  preparationForDay,
  updatePreparationTask,
} from "../shared/preparation.js";
import { sessionInputSchema } from "../shared/validation.js";

test("preparation scans group and parallel room details while filtering the selected day", () => {
  const session = createSession("owner", "Workshop", "en");
  const child = newBlock("en", { description: appendTask("", "Prepare room") });
  session.days[0].blocks = [
    newBlock("en", {
      kind: "group",
      children: [
        newBlock("en", {
          kind: "parallel",
          rooms: [{ id: "room-test", title: "Room", blocks: [child] }],
        }),
      ],
    }),
  ];
  assert.equal(
    preparationForDay(session, session.days[0].id).tasks[0].text,
    "Prepare room",
  );
  assert.deepEqual(preparationForDay(session, "other-day"), {
    tasks: [],
    materials: [],
  });
  const task = preparationForDay(session, session.days[0].id).tasks[0];
  const result = updatePreparationTask(session, task, true);
  assert.equal(
    preparationForDay(result, session.days[0].id).tasks[0].checked,
    true,
  );
  assert.equal(extractTasks(child.description)[0].checked, false);
  assert.throws(
    () => updatePreparationTask(result, task, false),
    /TASK_SOURCE_CHANGED/,
  );
});

test("adding preparation is atomic and creates a private column even if a public kind exists", () => {
  const session = createSession("owner", "Workshop", "fr");
  session.days[0].blocks = [newBlock("fr")];
  session.columns.push({
    id: "public-tasks",
    label: "Public tasks",
    kind: "tasks",
    visibility: "public",
    visible: true,
  });
  const before = JSON.stringify(session);
  const next = addPreparationItem(
    session,
    session.days[0].id,
    session.days[0].blocks[0].id,
    "tasks",
    "SECRET task",
    "fr",
  );
  const column = next.columns.at(-1)!;
  assert.equal(column.visibility, "team");
  assert.equal(column.visible, false);
  assert.equal(column.kind, "tasks");
  assert.equal(
    preparationForDay(next, next.days[0].id).tasks[0].text,
    "SECRET task",
  );
  assert.equal(
    JSON.stringify(publicProjection(next)).includes("SECRET"),
    false,
  );
  assert.equal(JSON.stringify(session), before);
  assert.equal(sessionInputSchema.safeParse(next).success, true);
  const second = addPreparationItem(
    next,
    next.days[0].id,
    next.days[0].blocks[0].id,
    "tasks",
    "Another task",
    "fr",
  );
  assert.equal(second.columns.length, next.columns.length);
  assert.equal(preparationForDay(second, second.days[0].id).tasks.length, 2);
});

test("preparation refuses missing destinations and column limits without partial edits", () => {
  const session = createSession("owner", "Workshop", "en");
  session.days[0].blocks = [newBlock("en")];
  // A public material column cannot receive new internal preparation items.
  session.columns
    .filter((column) => column.kind === "materials")
    .forEach((column) => {
      column.visibility = "public";
    });
  while (session.columns.length < 20)
    session.columns.push({
      id: `extra-${session.columns.length}`,
      label: "Column",
      visibility: "team",
      visible: false,
    });
  assert.equal(sessionInputSchema.safeParse(session).success, true);
  const before = JSON.stringify(session);
  assert.throws(
    () =>
      addPreparationItem(
        session,
        session.days[0].id,
        session.days[0].blocks[0].id,
        "materials",
        "Paper",
        "en",
      ),
    /COLUMN_LIMIT/,
  );
  assert.throws(
    () =>
      addPreparationItem(
        session,
        session.days[0].id,
        "missing",
        "tasks",
        "Task",
        "en",
      ),
    /BLOCK_MISSING/,
  );
  assert.equal(JSON.stringify(session), before);
});

test("preparation reuses the built-in private material column even at the column limit", () => {
  const session = createSession("owner", "Workshop", "en");
  session.days[0].blocks = [newBlock("en")];
  while (session.columns.length < 20)
    session.columns.push({
      id: `extra-${session.columns.length}`,
      label: "Column",
      visibility: "team",
      visible: false,
    });
  const next = addPreparationItem(
    session,
    session.days[0].id,
    session.days[0].blocks[0].id,
    "materials",
    "Private paper supply",
    "en",
  );
  assert.equal(next.columns.length, 20);
  assert.equal(
    preparationForDay(next, next.days[0].id).materials[0].text,
    "Private paper supply",
  );
  assert.equal(
    JSON.stringify(publicProjection(next)).includes("Private paper supply"),
    false,
  );
});
