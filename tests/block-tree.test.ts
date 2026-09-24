import test from "node:test";
import assert from "node:assert/strict";
import { newBlock } from "../shared/domain.js";
import type { Block } from "../shared/model.js";
import { insertBlockInto, relocateBlock } from "../src/block-tree.ts";

function agenda() {
  const a = newBlock("fr", { title: "A", duration: 5 });
  const b = newBlock("fr", { title: "B", duration: 10 });
  const g1 = newBlock("fr", { title: "G1", duration: 3 });
  const group = newBlock("fr", { title: "G", kind: "group", children: [g1] });
  const r1 = newBlock("fr", { title: "R1", duration: 4 });
  const parallel = newBlock("fr", {
    title: "P",
    kind: "parallel",
    rooms: [
      { id: "room-1", title: "Salle 1", blocks: [r1] },
      { id: "room-2", title: "Salle 2", blocks: [] },
    ],
  });
  return { blocks: [a, group, b, parallel], a, b, g1, group, r1, parallel };
}
const titles = (blocks: Block[]) => blocks.map((block) => block.title);

test("dragging a block into a group appends it and updates the group's duration", () => {
  const { blocks, a, group } = agenda();
  const moved = relocateBlock(blocks, a.id, { listId: group.id });
  assert.deepEqual(titles(moved), ["G", "B", "P"]);
  assert.deepEqual(titles(moved[0].children!), ["G1", "A"]);
  assert.equal(moved[0].duration, 8);
});

test("dropping on a child places the block before it inside the group", () => {
  const { blocks, b, g1, group } = agenda();
  const moved = relocateBlock(blocks, b.id, {
    listId: group.id,
    beforeId: g1.id,
  });
  assert.deepEqual(titles(moved[1].children!), ["B", "G1"]);
});

test("dragging a child out of a group puts it back in the agenda", () => {
  const { blocks, g1, b } = agenda();
  const moved = relocateBlock(blocks, g1.id, { listId: null, beforeId: b.id });
  assert.deepEqual(titles(moved), ["A", "G", "G1", "B", "P"]);
  assert.deepEqual(moved[1].children, []);
  assert.equal(moved[1].duration, 0);
});

test("blocks move between a group and parallel rooms, and between rooms", () => {
  const { blocks, g1, r1, parallel } = agenda();
  let moved = relocateBlock(blocks, g1.id, { listId: "room-2" });
  assert.deepEqual(titles(moved[3].rooms![1].blocks), ["G1"]);
  moved = relocateBlock(moved, r1.id, { listId: "room-2" });
  assert.deepEqual(titles(moved[3].rooms![0].blocks), []);
  assert.deepEqual(titles(moved[3].rooms![1].blocks), ["G1", "R1"]);
  assert.equal(moved[3].duration, 7);
  assert.equal(parallel.duration, 4, "the original tree is not mutated");
});

test("a container never moves into itself and invalid moves change nothing", () => {
  const { blocks, group, parallel } = agenda();
  assert.equal(relocateBlock(blocks, group.id, { listId: group.id }), blocks);
  assert.equal(
    relocateBlock(blocks, parallel.id, { listId: "room-1" }),
    blocks,
  );
  assert.equal(relocateBlock(blocks, "missing", { listId: null }), blocks);
  assert.equal(
    relocateBlock(blocks, group.id, { listId: "unknown-list" }),
    blocks,
  );
});

test("reordering in the agenda places the block before the drop target", () => {
  const { blocks, a, parallel } = agenda();
  const moved = relocateBlock(blocks, a.id, {
    listId: null,
    beforeId: parallel.id,
  });
  assert.deepEqual(titles(moved), ["G", "B", "A", "P"]);
});

test("inserting between blocks, inside a group or in a room", () => {
  const { blocks, b, g1, group } = agenda();
  const x = newBlock("fr", { title: "X", duration: 2 });
  assert.deepEqual(
    titles(insertBlockInto(blocks, x, { listId: null, beforeId: b.id })),
    ["A", "G", "X", "B", "P"],
  );
  const inGroup = insertBlockInto(blocks, x, {
    listId: group.id,
    beforeId: g1.id,
  });
  assert.deepEqual(titles(inGroup[1].children!), ["X", "G1"]);
  assert.equal(inGroup[1].duration, 5);
  const inRoom = insertBlockInto(blocks, x, { listId: "room-2" });
  assert.deepEqual(titles(inRoom[3].rooms![1].blocks), ["X"]);
});
