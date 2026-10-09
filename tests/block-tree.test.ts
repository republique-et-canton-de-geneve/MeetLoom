import test from "node:test";
import assert from "node:assert/strict";
import { newBlock } from "../shared/domain.js";
import type { Block } from "../shared/model.js";
import {
  carrySectionKeys,
  groupBlocks,
  insertBlockInto,
  insertSection,
  relocateBlock,
  renameSection,
  sectionKey,
  sectionRuns,
  startsSection,
  stepDestination,
} from "../src/block-tree.ts";

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

const sections = (blocks: Block[]) => blocks.map((block) => block.section);
const labelled = (title: string, section: string) =>
  newBlock("fr", { title, section });

test("a section inserted between rows gathers the blocks that follow, up to the end of their run", () => {
  const blocks = [
    labelled("A", ""),
    labelled("B", ""),
    labelled("C", "Après"),
    labelled("D", "Après"),
  ];
  const x = labelled("X", "");
  const before = insertSection(blocks, "Nouvelle section", x, blocks[1].id);
  assert.deepEqual(sections(before.blocks), [
    "",
    "Nouvelle section",
    "Après",
    "Après",
  ]);
  assert.deepEqual(titles(before.blocks), ["A", "B", "C", "D"]);
  assert.equal(before.firstId, blocks[1].id);
  const inside = insertSection(blocks, "Nouvelle section", x, blocks[3].id);
  assert.deepEqual(sections(inside.blocks), [
    "",
    "",
    "Après",
    "Nouvelle section",
  ]);
});

test("a section inserted where another starts, or at the end of the day, starts with a new activity", () => {
  const blocks = [
    labelled("A", ""),
    labelled("C", "Après"),
    labelled("D", "Après"),
  ];
  const x = labelled("X", "");
  const atStart = insertSection(blocks, "Nouvelle section", x, blocks[1].id);
  assert.deepEqual(titles(atStart.blocks), ["A", "X", "C", "D"]);
  assert.deepEqual(sections(atStart.blocks), [
    "",
    "Nouvelle section",
    "Après",
    "Après",
  ]);
  assert.equal(atStart.firstId, x.id);
  const atEnd = insertSection([blocks[0]], "Nouvelle section", x);
  assert.deepEqual(titles(atEnd.blocks), ["A", "X"]);
  assert.deepEqual(sections(atEnd.blocks), ["", "Nouvelle section"]);
  assert.equal(atEnd.firstId, x.id);
});

test("new section labels are numbered so two new sections never merge", () => {
  const blocks = [labelled("a", ""), labelled("b", ""), labelled("c", "")];
  const first = insertSection(
    blocks,
    "Nouvelle section",
    labelled("X", ""),
    blocks[0].id,
  );
  const second = insertSection(
    first.blocks,
    "Nouvelle section",
    labelled("Y", ""),
    blocks[1].id,
  );
  assert.deepEqual(sections(second.blocks), [
    "Nouvelle section",
    "Nouvelle section 2",
    "Nouvelle section 2",
  ]);
  assert.equal(sectionRuns(second.blocks).filter((run) => run.label).length, 2);
});

test("a block inserted or moved before another joins its section; an explicit section wins; the end continues the last section", () => {
  const a1 = labelled("a1", "A"),
    a2 = labelled("a2", "A"),
    b1 = labelled("b1", "B");
  const blocks = [a1, a2, b1];
  const x = labelled("x", "");
  const inserted = insertBlockInto(blocks, x, {
    listId: null,
    beforeId: a2.id,
  });
  assert.equal(inserted[1].section, "A");
  const outside = insertBlockInto(blocks, x, {
    listId: null,
    beforeId: b1.id,
    section: "",
  });
  assert.equal(outside[2].section, "");
  const up = relocateBlock(blocks, b1.id, { listId: null, beforeId: a2.id });
  assert.deepEqual(titles(up), ["a1", "b1", "a2"]);
  assert.equal(up[1].section, "A");
  const end = relocateBlock(blocks, a1.id, { listId: null });
  assert.deepEqual(titles(end), ["a2", "b1", "a1"]);
  assert.equal(end[2].section, "B");
  // Dropping the block that follows a section onto that section's footer.
  const footer = relocateBlock(blocks, b1.id, {
    listId: null,
    beforeId: b1.id,
    section: "A",
  });
  assert.deepEqual(titles(footer), ["a1", "a2", "b1"]);
  assert.deepEqual(sections(footer), ["A", "A", "A"]);
  assert.equal(
    relocateBlock(blocks, b1.id, {
      listId: null,
      beforeId: b1.id,
      section: "B",
    }),
    blocks,
    "an unchanged move returns the same array, so the editor records nothing",
  );
  // Dropped where it already is: before the block that follows it, a
  // section's last block on that section's footer, the day's last block on
  // the end of the day.
  for (const [block, destination] of [
    [a1, { listId: null, beforeId: a2.id }],
    [a2, { listId: null, beforeId: b1.id, section: "A" }],
    [b1, { listId: null, section: "B" }],
    [b1, { listId: null }],
  ] as const)
    assert.equal(
      relocateBlock(blocks, block.id, destination),
      blocks,
      `${block.title} in place`,
    );
  // In place, only its section changes: the next section's first row takes
  // the block into that section, the footer below the day leaves every one.
  const across = relocateBlock(blocks, a2.id, {
    listId: null,
    beforeId: b1.id,
  });
  assert.deepEqual(titles(across), ["a1", "a2", "b1"]);
  assert.deepEqual(sections(across), ["A", "B", "B"]);
  const unlabelled = relocateBlock(blocks, b1.id, {
    listId: null,
    section: "",
  });
  assert.deepEqual(titles(unlabelled), ["a1", "a2", "b1"]);
  assert.deepEqual(sections(unlabelled), ["A", "A", ""]);
});

test("renaming a section relabels only its own run; an empty name removes it but keeps the blocks", () => {
  const blocks = [
    labelled("x", "A"),
    labelled("y", "A"),
    labelled("z", "B"),
    labelled("w", "A"),
  ];
  assert.deepEqual(sections(renameSection(blocks, blocks[0].id, " Matin ")), [
    "Matin",
    "Matin",
    "B",
    "A",
  ]);
  const removed = renameSection(blocks, blocks[0].id, "");
  assert.deepEqual(sections(removed), ["", "", "B", "A"]);
  assert.deepEqual(titles(removed), ["x", "y", "z", "w"]);
  assert.equal(renameSection(blocks, "missing", "Matin"), blocks);
  assert.equal(renameSection(removed, removed[0].id, "Matin"), removed);
  assert.deepEqual(sectionRuns(blocks), [
    { label: "A", start: 0, end: 2 },
    { label: "B", start: 2, end: 3 },
    { label: "A", start: 3, end: 4 },
  ]);
  assert.equal(startsSection(blocks, 0), true);
  assert.equal(startsSection(blocks, 1), false);
  assert.equal(startsSection(blocks, 3), true);
  assert.equal(startsSection(removed, 0), false, "no label, no section");
});

test("two sections with the same name keep their own state, which follows them when blocks are added", () => {
  const blocks = [
    labelled("x", "A"),
    labelled("y", "B"),
    labelled("z", "A"),
    labelled("w", ""),
  ];
  assert.equal(sectionKey(blocks, 0), "A#0");
  assert.equal(sectionKey(blocks, 1), "B#0");
  assert.equal(sectionKey(blocks, 2), "A#1", "not the first A section's key");
  assert.equal(sectionKey(blocks, 3), undefined, "outside every section");
  // A block added at the top of the second "A" keeps that section's key.
  const added = insertBlockInto(blocks, labelled("new", ""), {
    listId: null,
    beforeId: blocks[2].id,
  });
  assert.equal(sectionKey(added, 2), "A#1");
  // Renamed to its neighbour's name, it merges into that section.
  const merged = renameSection(blocks, blocks[2].id, "B");
  assert.equal(sectionKey(merged, 2), "B#0");
});

test("a collapsed section stays collapsed through any change of the day, and only that section", () => {
  const blocks = [
    labelled("x", "A"),
    labelled("y", "B"),
    labelled("z", "A"),
    labelled("z2", "A"),
  ];
  const day = "d1:",
    other = "d2:A#0";
  // The second "A" is collapsed; another day's state is left alone.
  const collapsed = new Set([`${day}A#1`, other]);
  const carry = (after: typeof blocks) =>
    [...carrySectionKeys(collapsed, day, blocks, after)].sort();
  // Renaming the first "A" makes the second the first "A": it stays collapsed.
  assert.deepEqual(carry(renameSection(blocks, blocks[0].id, "C")), [
    `${day}A#0`,
    other,
  ]);
  // So does deleting the first "A" section's only block.
  assert.deepEqual(carry(blocks.slice(1)), [`${day}A#0`, other]);
  // Renaming the collapsed section itself carries its state to the new name.
  assert.deepEqual(carry(renameSection(blocks, blocks[2].id, "D")), [
    `${day}D#0`,
    other,
  ]);
  // Its first block moved elsewhere: the state stays with the rest of it.
  const moved = relocateBlock(blocks, blocks[2].id, {
    listId: null,
    beforeId: blocks[1].id,
  });
  assert.deepEqual(carry(moved), [`${day}A#1`, other]);
  // Removing the section leaves no key behind.
  assert.deepEqual(carry(renameSection(blocks, blocks[2].id, "")), [other]);
  // Nothing changed: the same set comes back.
  assert.equal(carrySectionKeys(collapsed, day, blocks, blocks), collapsed);
});

test("grouping blocks inside a section keeps the group in that section", () => {
  const a1 = labelled("a1", "A"),
    a2 = labelled("a2", "A"),
    b = labelled("b", "B");
  const both = newBlock("fr", {
    title: "G",
    kind: "group",
    children: [a1, a2],
  });
  const grouped = groupBlocks([a1, a2, b], new Set([a1.id, a2.id]), both);
  assert.deepEqual(titles(grouped), ["G", "b"]);
  assert.equal(grouped[0].section, "A");
  assert.deepEqual(titles(grouped[0].children!), ["a1", "a2"]);
  const one = newBlock("fr", { title: "G", kind: "group", children: [a2] });
  const second = groupBlocks([a1, a2, b], new Set([a2.id]), one);
  assert.deepEqual(titles(second), ["a1", "G", "b"]);
  assert.equal(second[1].section, "A");
});

test("one step up or down crosses a section boundary in place before passing a block", () => {
  const blocks = [
    labelled("a1", "A"),
    labelled("a2", "A"),
    labelled("b1", "B"),
    labelled("c1", "C"),
    labelled("c2", "C"),
  ];
  const step = (list: Block[], title: string, up: boolean) => {
    const id = list.find((block) => block.title === title)!.id;
    const destination = stepDestination(list, id, up);
    return destination && relocateBlock(list, id, destination);
  };
  // The last block of A goes down into B, at its top, and skips nothing.
  const down = step(blocks, "a2", false)!;
  assert.deepEqual(titles(down), ["a1", "a2", "b1", "c1", "c2"]);
  assert.deepEqual(sections(down), ["A", "B", "B", "C", "C"]);
  // The only block of B goes up to the end of A, not into its middle.
  const up = step(blocks, "b1", true)!;
  assert.deepEqual(titles(up), ["a1", "a2", "b1", "c1", "c2"]);
  assert.deepEqual(sections(up), ["A", "A", "A", "C", "C"]);
  // Within a section, the block swaps with its neighbour and stays there.
  const swap = step(blocks, "a1", false)!;
  assert.deepEqual(titles(swap), ["a2", "a1", "b1", "c1", "c2"]);
  assert.deepEqual(sections(swap), ["A", "A", "B", "C", "C"]);
  const last = step(blocks, "c1", false)!;
  assert.deepEqual(titles(last), ["a1", "a2", "b1", "c2", "c1"]);
  assert.deepEqual(sections(last), ["A", "A", "B", "C", "C"]);
  // The first block of a section leaves it before passing an outside block.
  const outside = [labelled("x", ""), labelled("a1", "A"), labelled("a2", "A")];
  const left = step(outside, "a1", true)!;
  assert.deepEqual(titles(left), ["x", "a1", "a2"]);
  assert.deepEqual(sections(left), ["", "", "A"]);
  assert.equal(step(blocks, "a1", true), undefined);
  assert.equal(step(blocks, "c2", false), undefined);
});
