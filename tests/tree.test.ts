import test from "node:test";
import assert from "node:assert/strict";
import type { Block } from "../shared/model.js";
import {
  allBlocks,
  blockDuration,
  cloneBlockTree,
  createSession,
  mapBlocks,
  newBlock,
  publicProjection,
  runnableBlocks,
  scheduleDay,
  scheduleTreeDay,
  timerView,
  totalDuration,
  transitionRun,
} from "../shared/domain.js";
import { blockSchema, sessionInputSchema } from "../shared/validation.js";
import {
  duplicateBlockInTree,
  insertBlockAfter,
  moveBlockInTree,
  moveBlockToList,
  removeBlockFromTree,
} from "../src/block-tree.js";

const leaf = (title: string, duration: number) =>
  newBlock("en", { title, duration });
function tree() {
  const group = newBlock("en", {
    kind: "group",
    title: "Opening group",
    children: [
      leaf("A", 10),
      newBlock("en", {
        kind: "note",
        title: "Prompt",
        description: "Keep the discussion focused",
      }),
      newBlock("en", {
        kind: "group",
        title: "Subgroup",
        children: [leaf("B", 5)],
      }),
    ],
  });
  const parallel = newBlock("en", {
    kind: "parallel",
    title: "Breakouts",
    rooms: [
      {
        id: crypto.randomUUID(),
        title: "Room 1",
        blocks: [leaf("C", 8), leaf("D", 7)],
      },
      {
        id: crypto.randomUUID(),
        title: "Room 2",
        blocks: [
          newBlock("en", {
            kind: "group",
            title: "Deep group",
            children: [leaf("E", 20)],
          }),
        ],
      },
    ],
  });
  const session = createSession("owner", "Nested agenda", "en");
  session.days[0].blocks = [group, parallel, leaf("Close", 5)];
  return { session, group, parallel };
}

test("group work is summed, parallel work takes the longest room, notes cost zero", () => {
  const { session, group, parallel } = tree();
  assert.equal(blockDuration(group), 15);
  assert.equal(blockDuration(parallel), 20);
  assert.equal(totalDuration(session), 40);
  const changed = mapBlocks(session.days[0].blocks, (block) =>
    block.title === "C" ? { ...block, duration: 30 } : block,
  );
  assert.equal(changed[1].duration, 37);
  const forged = structuredClone(session);
  forged.days[0].blocks[0].duration = 1;
  assert.equal(
    sessionInputSchema.parse(forged).days[0].blocks[0].duration,
    15,
    "stored container durations are canonicalized",
  );
  assert.equal(allBlocks(session.days[0].blocks).length, 11);
});

test("nested locks preserve sequence gaps while rooms start together", () => {
  const { session, group } = tree();
  const day = session.days[0];
  // The day's start time anchors the first (group) block and its first child.
  day.startTime = "10:00";
  group.children![0].lockedStart = "10:00";
  group.children![2].children![0].lockedStart = "10:20";
  const rows = scheduleTreeDay(day),
    top = scheduleDay(day);
  assert.equal(top[0].startMinute, 600);
  assert.equal(top[0].endMinute, 625);
  assert.equal(rows.find((row) => row.block.title === "B")!.startMinute, 620);
  assert.equal(
    rows.find((row) => row.block.title === "Subgroup")!.gapMinutes,
    10,
  );
  assert.equal(rows.find((row) => row.block.title === "C")!.startMinute, 625);
  assert.equal(rows.find((row) => row.block.title === "E")!.startMinute, 625);
  assert.deepEqual(rows.find((row) => row.block.title === "E")!.roomPath, [
    "Room 2",
  ]);
  assert.equal(top[1].endMinute, 645);
  assert.equal(top[2].startMinute, 645);
});

test("the linear timer visits group leaves, skips notes, extends nested blocks and accepts parallel rooms", () => {
  const { session, group } = tree();
  assert.equal(transitionRun(session, "start", {}, 1000).run.status, "running");
  session.days[0].blocks = [group];
  assert.deepEqual(
    runnableBlocks([group]).map((block) => block.title),
    ["A", "B"],
  );
  let run = transitionRun(session, "start", { blockId: group.id }, 1000);
  assert.equal(timerView(run, 1000).block?.title, "A");
  run = transitionRun(run, "extend", { seconds: 60 }, 2000);
  assert.equal(run.days[0].blocks[0].duration, 16);
  assert.equal(
    allBlocks(run.days[0].blocks).find((block) => block.title === "A")!
      .duration,
    11,
  );
  run = transitionRun(run, "next", {}, 61_000);
  assert.equal(timerView(run, 61_000).block?.title, "B");
  assert.equal(sessionInputSchema.safeParse(run).success, true);
  const projected = publicProjection(run);
  assert.equal(timerView(projected, 61_000).block?.title, "B");
  run = transitionRun(run, "stop", {}, 121_000);
  run = transitionRun(run, "apply-actual", {}, 121_000);
  assert.equal(run.days[0].blocks[0].duration, 2);
  run = transitionRun(run, "restore-plan", {}, 121_000);
  assert.equal(run.days[0].blocks[0].duration, 15);
});

test("recursive public projection removes private content and unrecognized data at every depth", () => {
  const { session } = tree();
  session.columns.forEach((column) => {
    column.visibility = "team";
  });
  for (const block of allBlocks(session.days[0].blocks)) {
    block.description = "PRIVATE_DESCRIPTION";
    block.facilitator = "PRIVATE_PERSON";
    block.fields = { notes: "PRIVATE_NOTES" };
    Object.assign(block, { privateMetadata: "PRIVATE_METADATA" });
    for (const room of block.rooms ?? [])
      Object.assign(room, { credentials: "PRIVATE_ROOM" });
  }
  const publicSession = publicProjection(session);
  assert.equal(JSON.stringify(publicSession).includes("PRIVATE_"), false);
  assert.equal(allBlocks(publicSession.days[0].blocks).length, 11);
  publicSession.days[0].blocks[1].rooms![1].blocks[0].children![0].title =
    "Public copy";
  assert.equal(
    allBlocks(session.days[0].blocks).find((block) => block.title === "E")!
      .title,
    "E",
  );
});

test("tree validation bounds recursion before parsing and rejects duplicate descendant and room identities", () => {
  const { session } = tree();
  assert.equal(sessionInputSchema.safeParse(session).success, true);
  const repeated = structuredClone(session);
  repeated.days[0].blocks[1].rooms![1].blocks[0].children![0].id =
    repeated.days[0].blocks[0].id;
  assert.equal(sessionInputSchema.safeParse(repeated).success, false);
  const roomCollision = structuredClone(session);
  roomCollision.days[0].blocks[1].rooms![0].id = roomCollision.days[0].id;
  assert.equal(sessionInputSchema.safeParse(roomCollision).success, false);
  let tooDeep = leaf("Deep", 1);
  for (let index = 0; index < 1000; index++)
    tooDeep = { ...leaf("Container", 1), kind: "group", children: [tooDeep] };
  assert.doesNotThrow(() =>
    assert.equal(blockSchema.safeParse(tooDeep).success, false),
  );
  const cyclic = newBlock("en", { kind: "group" });
  cyclic.children!.push(cyclic);
  assert.equal(blockSchema.safeParse(cyclic).success, false);
  const fakeLeaf = leaf("Not a group", 1);
  fakeLeaf.children = [leaf("Hidden", 1)];
  assert.equal(blockSchema.safeParse(fakeLeaf).success, false);
  const tooMany = newBlock("en", {
    kind: "group",
    children: Array.from({ length: 1000 }, () => leaf("Child", 0)),
  });
  assert.equal(blockSchema.safeParse(tooMany).success, false);
});

test("cloning, moving and deleting nested blocks preserve identities, sibling order and parent durations", () => {
  const { group, parallel } = tree();
  const root = newBlock("en", { kind: "group", children: [group, parallel] });
  const ids = (block: Block) =>
    allBlocks([block]).flatMap((value) => [
      value.id,
      ...(value.rooms ?? []).map((room) => room.id),
    ]);
  const cloned = cloneBlockTree(root);
  assert.equal(
    ids(cloned).some((id) => ids(root).includes(id)),
    false,
  );
  const source = group.children![0],
    target = parallel.rooms![0];
  const moved = moveBlockToList(root, source.id, target.id);
  assert.equal(
    allBlocks([moved]).filter((block) => block.id === source.id).length,
    1,
  );
  assert.equal(
    allBlocks([moved]).find((block) => block.id === group.id)!.duration,
    5,
  );
  assert.equal(
    allBlocks([moved]).find((block) => block.id === parallel.id)!.duration,
    25,
  );
  assert.equal(
    moveBlockToList(root, group.id, group.children![2].id),
    root,
    "cannot create a cycle",
  );
  assert.equal(
    moveBlockToList(root, source.id, "missing"),
    root,
    "failed targets do not discard blocks",
  );
  const duplicate = duplicateBlockInTree([root], source.id);
  assert.equal(duplicate[0].duration, root.duration + 10);
  const removed = removeBlockFromTree([root], source.id);
  assert.equal(removed[0].duration, root.duration - 10);
  assert.equal(
    moveBlockInTree([root], group.children![1].id, -1)[0].children![0]
      .children![0].kind,
    "note",
  );
  assert.equal(
    allBlocks(insertBlockAfter([root], source.id, leaf("Inserted", 3))).find(
      (block) => block.title === "Inserted",
    )?.duration,
    3,
  );
});

test("metadata stays internal and every descendant category must belong to the agenda", () => {
  const { session } = tree();
  session.client = "Internal client";
  session.tags = ["Internal tag"];
  session.folder = "Internal folder";
  session.categories = [{ id: "custom", label: "Discovery", color: "#123aBc" }];
  const deep = session.days[0].blocks[1].rooms![1].blocks[0].children![0];
  deep.category = "custom";
  assert.equal(sessionInputSchema.safeParse(session).success, true);
  const projected = publicProjection(session);
  assert.equal(JSON.stringify(projected).includes("Internal"), false);
  assert.equal(projected.categories?.[0].id, "custom");
  deep.category = "missing";
  assert.equal(sessionInputSchema.safeParse(session).success, false);
  deep.category = "custom";
  session.categories[0].color = "red";
  assert.equal(sessionInputSchema.safeParse(session).success, false);
  session.categories[0].color = "#123456";
  session.tags = Array.from({ length: 21 }, (_, index) => `${index}`);
  assert.equal(sessionInputSchema.safeParse(session).success, false);
});
