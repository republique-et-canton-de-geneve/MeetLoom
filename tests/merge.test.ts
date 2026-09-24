import test from "node:test";
import assert from "node:assert/strict";
import {
  allBlocks,
  createSession,
  mapBlocks,
  newBlock,
} from "../shared/domain.js";
import { mergeSessionDraft, editableDocument } from "../src/session-merge.js";
const fixture = () => {
  const session = createSession("owner", "Workshop", "en");
  session.days[0].blocks = ["A", "B", "C", "D"].map((title) =>
    newBlock("en", { id: `block-${title}`, title, duration: 10 }),
  );
  return session;
};

test("workspace and future privileged lifecycle metadata never enter editable drafts or merges", () => {
  const base = {
      ...fixture(),
      workspaceId: "workspace-a",
      closedAt: "server-metadata",
    },
    local = structuredClone(base),
    remote = structuredClone(base);
  local.title = "Draft title";
  local.workspaceId = "forged";
  local.closedAt = "forged";
  remote.workspaceId = "workspace-b";
  remote.closedAt = "authoritative";
  const editable = editableDocument(local);
  assert.equal("workspaceId" in editable, false);
  assert.equal("closedAt" in editable, false);
  const result = mergeSessionDraft(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.session?.title, "Draft title");
  assert.equal(result.session?.workspaceId, "workspace-b");
  assert.equal((result.session as typeof base).closedAt, "authoritative");
});
test("undo inverts only my edit and keeps another collaborator changes", () => {
  const before = fixture(),
    after = structuredClone(before);
  after.days[0].blocks[0].title = "My change";
  const remote = structuredClone(after);
  remote.days[0].blocks[1].duration = 42;
  const undo = mergeSessionDraft(after, before, remote);
  assert.ok(undo.session);
  assert.equal(undo.session.days[0].blocks[0].title, "A");
  assert.equal(undo.session.days[0].blocks[1].duration, 42);
  remote.days[0].blocks[0].title = "Their newer change";
  assert.equal(mergeSessionDraft(after, before, remote).session, null);
});

test("independent document, block and custom-field edits merge by stable identity", () => {
  const base = fixture(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.title = "Local title";
  local.days[0].blocks[0].title = "Local activity";
  remote.description = "Remote description";
  remote.days[0].blocks[0].facilitator = "Another facilitator";
  remote.days[0].blocks[1].fields.notes = "Remote private prompt";
  remote.version = 4;
  remote.run.revision = 2;
  const result = mergeSessionDraft(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.session?.title, local.title);
  assert.equal(result.session?.description, remote.description);
  assert.equal(result.session?.days[0].blocks[0].title, "Local activity");
  assert.equal(
    result.session?.days[0].blocks[0].facilitator,
    "Another facilitator",
  );
  assert.equal(
    result.session?.days[0].blocks[1].fields.notes,
    "Remote private prompt",
  );
  assert.equal(result.session?.version, 4);
  assert.equal(result.session?.run.revision, 2);
  assert.equal(base.title, "Workshop");
});

test("same-field edits and delete-versus-edit preserve an explicit conflict", () => {
  const base = fixture(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.days[0].blocks[0].title = "Local";
  remote.days[0].blocks[0].title = "Remote";
  assert.equal(mergeSessionDraft(base, local, remote).session, null);
  assert.match(
    mergeSessionDraft(base, local, remote).conflicts[0],
    /block-A.*title/,
  );
  local.days[0].blocks.shift();
  assert.equal(mergeSessionDraft(base, local, remote).session, null);
  remote.days[0].blocks[0].title = "A";
  remote.days[0].blocks[1].description = "Independent";
  const merged = mergeSessionDraft(base, local, remote).session!;
  assert.deepEqual(
    merged.days[0].blocks.map((block) => block.title),
    ["B", "C", "D"],
  );
  assert.equal(merged.days[0].blocks[0].description, "Independent");
});

test("concurrent insertions converge deterministically and identity collisions are rejected", () => {
  const base = fixture(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.days[0].blocks.splice(
    1,
    0,
    newBlock("en", { id: "added-L", title: "Local addition" }),
  );
  remote.days[0].blocks.splice(
    1,
    0,
    newBlock("en", { id: "added-R", title: "Remote addition" }),
  );
  const one = mergeSessionDraft(base, local, remote).session!,
    other = mergeSessionDraft(base, remote, local).session!;
  assert.deepEqual(one.days, other.days);
  assert.deepEqual(
    one.days[0].blocks.map((block) => block.id),
    ["block-A", "added-L", "added-R", "block-B", "block-C", "block-D"],
  );
  remote.days[0].blocks[1].id = "added-L";
  assert.equal(mergeSessionDraft(base, local, remote).session, null);
});

test("independent reorders combine while incompatible ordering remains a conflict", () => {
  const base = fixture(),
    local = structuredClone(base),
    remote = structuredClone(base);
  const [a, b, c, d] = local.days[0].blocks;
  local.days[0].blocks = [b, a, c, d];
  remote.days[0].blocks = [
    remote.days[0].blocks[0],
    remote.days[0].blocks[1],
    remote.days[0].blocks[3],
    remote.days[0].blocks[2],
  ];
  assert.deepEqual(
    mergeSessionDraft(base, local, remote).session!.days[0].blocks.map(
      (block) => block.title,
    ),
    ["B", "A", "D", "C"],
  );
  remote.days[0].blocks = [a, c, b, d];
  const conflict = mergeSessionDraft(base, local, remote);
  assert.equal(conflict.session, null);
  assert.ok(conflict.conflicts.some((path) => path.endsWith(".order")));
});

test("independent nested duration edits recompute their shared parent instead of conflicting on derived totals", () => {
  const base = fixture();
  base.days[0].blocks = [
    newBlock("en", { kind: "group", children: base.days[0].blocks }),
  ];
  const local = structuredClone(base),
    remote = structuredClone(base);
  local.days[0].blocks = mapBlocks(local.days[0].blocks, (block) =>
    block.id === "block-A" ? { ...block, duration: 15 } : block,
  );
  remote.days[0].blocks = mapBlocks(remote.days[0].blocks, (block) =>
    block.id === "block-B" ? { ...block, duration: 20 } : block,
  );
  const result = mergeSessionDraft(base, local, remote);
  assert.deepEqual(result.conflicts, []);
  assert.equal(result.session!.days[0].blocks[0].duration, 55);
});

test("unfinished local titles survive polling, but newly invalid references or cross-tree identities do not auto-merge", () => {
  const base = fixture(),
    local = structuredClone(base),
    remote = structuredClone(base);
  local.title = "";
  remote.description = "Remote edit";
  assert.equal(mergeSessionDraft(base, local, remote).session?.title, "");
  local.days[0].blocks.push(newBlock("en", { id: "collision" }));
  remote.days.push({
    ...remote.days[0],
    id: "another-day",
    blocks: [newBlock("en", { id: "collision" })],
  });
  assert.equal(mergeSessionDraft(base, local, remote).session, null);
  const structured = fixture();
  structured.categories = [{ id: "custom", label: "Custom", color: "#123456" }];
  const changed = structuredClone(structured),
    removed = structuredClone(structured);
  changed.days[0].blocks[0].category = "custom";
  removed.categories = [];
  assert.equal(mergeSessionDraft(structured, changed, removed).session, null);
  assert.equal(
    allBlocks(changed.days[0].blocks)[0].category,
    "custom",
    "source draft stays intact",
  );
});
