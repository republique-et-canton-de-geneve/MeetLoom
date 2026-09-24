import { test } from "node:test";
import assert from "node:assert/strict";
import type { Session } from "../shared/model.js";
import { allBlocks, newBlock } from "../shared/domain.js";
import { newPage, newForm } from "../shared/content.js";
import { harness } from "./support.js";

test("named versions support private previews, optimistic metadata and cross-session isolation", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  const path = `/sessions/${session.id}`;
  const named = await h.owner.request(path + "/versions", "POST", {
    version: session.version,
    name: "Approved baseline",
    description: "Before the review",
  });
  assert.equal(named.status, 201, JSON.stringify(named.body));
  const version = named.body.version;
  const preview = await h.owner.request(path + `/versions/${version.id}`);
  assert.equal(preview.body.session.id, session.id);
  assert.equal(preview.body.version.description, "Before the review");
  assert.equal((await h.client().request(path + "/versions")).status, 401);
  const stranger = await h.account("history-outsider@example.test");
  assert.equal((await stranger.client.request(path + "/versions")).status, 404);
  const second = await h.session();
  assert.equal(
    (await h.owner.request(`/sessions/${second.id}/versions/${version.id}`))
      .status,
    404,
  );
  const viewer = await h.account("history-reader@example.test");
  await h.owner.request(path + "/members", "POST", {
    email: viewer.user.email,
    role: "viewer",
  });
  assert.equal(
    (await viewer.client.request(path + `/versions/${version.id}`)).status,
    200,
  );
  assert.equal(
    (
      await viewer.client.request(path + "/versions", "POST", {
        version: session.version,
        name: "Denied",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await viewer.client.request(path + `/versions/${version.id}`, "DELETE", {
        version: session.version,
        revision: 1,
      })
    ).status,
    403,
  );
  const updates = await Promise.all(
    ["One", "Two"].map((name) =>
      h.owner.request(path + `/versions/${version.id}`, "PATCH", {
        version: session.version,
        revision: 1,
        name,
        description: "Updated",
      }),
    ),
  );
  assert.deepEqual(updates.map((result) => result.status).sort(), [200, 409]);
  const refreshed = (
    await h.owner.request(path + "/versions")
  ).body.versions.find((item: { id: string }) => item.id === version.id);
  assert.equal(refreshed.revision, 2);
  assert.equal(
    (
      await h.owner.request(path + `/versions/${version.id}`, "DELETE", {
        version: session.version,
        revision: 1,
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await h.owner.request(path + `/versions/${version.id}`, "DELETE", {
        version: session.version,
        revision: 2,
      })
    ).status,
    204,
  );
  assert.equal(
    (await h.owner.request(path + `/versions/${version.id}`)).status,
    404,
  );
  assert.equal(
    (
      await h.owner.request(path + "/versions", "POST", {
        version: session.version,
        name: "",
        description: "bad",
      })
    ).status,
    400,
  );
});

test("historical day replacement protects active runs, copy regenerates IDs and private columns stay private", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  const path = `/sessions/${session.id}`;
  session.days.push({
    ...structuredClone(session.days[0]),
    id: crypto.randomUUID(),
    title: "Second day",
    blocks: [newBlock("en")],
  });
  session = (
    await h.owner.request(path, "PUT", { session, version: session.version })
  ).body.session;
  const source = structuredClone(session);
  const named = (
    await h.owner.request(path + "/versions", "POST", {
      version: session.version,
      name: "Before changes",
    })
  ).body.version;
  session.columns.find((column) => column.id === "notes")!.visibility =
    "public";
  session.days[0].blocks[0].title = "New title";
  session = (
    await h.owner.request(path, "PUT", { session, version: session.version })
  ).body.session;
  session = (
    await h.owner.request(path + "/run", "POST", {
      action: "start",
      dayId: session.days[0].id,
      blockId: session.days[0].blocks[0].id,
      revision: session.run.revision,
    })
  ).body.session;
  assert.equal(session.run.status, "running");
  const denied = await h.owner.request(
    path + `/versions/${named.id}/restore`,
    "POST",
    {
      version: session.version,
      dayId: source.days[0].id,
      mode: "replace",
      targetDayId: session.days[0].id,
    },
  );
  assert.equal(denied.status, 409);
  assert.equal(denied.body.code, "HISTORY_RUN_ACTIVE");
  assert.equal(
    (
      await h.owner.request(path + `/versions/${named.id}/restore`, "POST", {
        version: session.version,
      })
    ).status,
    409,
  );
  const beforeRun = structuredClone(session.run);
  const copied = await h.owner.request(
    path + `/versions/${named.id}/restore`,
    "POST",
    { version: session.version, dayId: source.days[0].id, mode: "copy" },
  );
  assert.equal(copied.status, 200, JSON.stringify(copied.body));
  session = copied.body.session;
  assert.deepEqual(session.run, beforeRun);
  assert.equal(session.days.length, 3);
  const oldIds = new Set(
    source.days.flatMap((day) =>
      allBlocks(day.blocks).map((block) => block.id),
    ),
  );
  assert.ok(session.days[2].blocks.every((block) => !oldIds.has(block.id)));
  assert.equal(
    session.columns.find((column) => column.id === "notes")?.visibility,
    "team",
  );
  const replaced = await h.owner.request(
    path + `/versions/${named.id}/restore`,
    "POST",
    {
      version: session.version,
      dayId: source.days[0].id,
      mode: "replace",
      targetDayId: session.days[1].id,
    },
  );
  assert.equal(replaced.status, 200, JSON.stringify(replaced.body));
  assert.deepEqual(replaced.body.session.run, beforeRun);
  assert.equal(
    new Set(
      replaced.body.session.days.flatMap((day: Session["days"][number]) =>
        allBlocks(day.blocks).map((block) => block.id),
      ),
    ).size,
    replaced.body.session.days.flatMap((day: Session["days"][number]) =>
      allBlocks(day.blocks),
    ).length,
  );
});

test("deleted nested elements survive automatic snapshot pruning, restore once and journal authors have readable diffs", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  const path = `/sessions/${session.id}`;
  const child = newBlock("en", {
    title: "Recover this child",
    description: "Private description",
    fields: { notes: "TEAM_RECOVERY_SECRET" },
  });
  const group = newBlock("en", {
    kind: "group",
    title: "Nested group",
    children: [child],
  });
  session.days[0].blocks.push(group);
  session = (
    await h.owner.request(path, "PUT", { session, version: session.version })
  ).body.session;
  const named = (
    await h.owner.request(path + "/versions", "POST", {
      version: session.version,
      name: "Keep permanently",
    })
  ).body.version;
  const editor = await h.account("history-editor@example.test");
  await h.owner.request(path + "/members", "POST", {
    email: editor.user.email,
    role: "editor",
  });
  const currentGroup = session.days[0].blocks.find(
    (block) => block.id === group.id,
  )!;
  currentGroup.children = [];
  session = (
    await editor.client.request(path, "PUT", {
      session,
      version: session.version,
    })
  ).body.session;
  const trash = (await h.owner.request(path + "/deleted-elements")).body
    .elements;
  assert.equal(trash.length, 1);
  assert.equal(trash[0].title, child.title);
  assert.equal(trash[0].author, editor.user.name);
  assert.equal(JSON.stringify(trash).includes("TEAM_RECOVERY_SECRET"), false);
  for (let index = 0; index < 105; index++) {
    session.title = `Edited ${index}`;
    const saved = await h.owner.request(path, "PUT", {
      session,
      version: session.version,
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    session = saved.body.session;
  }
  const versions = (await h.owner.request(path + "/versions")).body.versions;
  assert.equal(
    versions.filter((version: { named: boolean }) => !version.named).length,
    100,
  );
  assert.ok(
    versions.some((version: { id: string }) => version.id === named.id),
  );
  assert.ok(
    (await h.owner.request(path + "/deleted-elements")).body.elements.some(
      (item: { id: string }) => item.id === trash[0].id,
    ),
  );
  const attempts = await Promise.all(
    [0, 1].map(() =>
      h.owner.request(
        path + `/deleted-elements/${trash[0].id}/restore`,
        "POST",
        { version: session.version },
      ),
    ),
  );
  // Exactly one concurrent restore wins. The other is refused either by the
  // version check (409) or, if it read the session before the winner committed,
  // because the item is already restored (410); both orders are legitimate.
  const statuses = attempts.map((result) => result.status).sort();
  assert.equal(statuses[0], 200, JSON.stringify(statuses));
  assert.ok([409, 410].includes(statuses[1]), JSON.stringify(statuses));
  session = attempts.find((result) => result.status === 200)!.body.session;
  assert.equal(
    session.days[0].blocks.find((block) => block.id === group.id)?.children?.[0]
      .fields.notes,
    "TEAM_RECOVERY_SECRET",
  );
  assert.equal(
    (await h.owner.request(path + "/deleted-elements")).body.elements.length,
    0,
  );
  assert.equal(
    (
      await h.owner.request(
        path + `/deleted-elements/${trash[0].id}/restore`,
        "POST",
        { version: session.version },
      )
    ).status,
    410,
  );
  const journal = (await h.owner.request(path + "/journal")).body;
  assert.equal(journal.entries.length, 100);
  assert.ok(journal.nextBeforeVersion);
  const earlier = (
    await h.owner.request(
      path + `/journal?beforeVersion=${journal.nextBeforeVersion}`,
    )
  ).body.entries;
  assert.ok(
    earlier.some(
      (entry: {
        author: string;
        changes: { title: string; action: string }[];
      }) =>
        entry.author === editor.user.name &&
        entry.changes.some(
          (change) =>
            change.title === child.title && change.action === "deleted",
        ),
    ),
  );
  assert.ok(
    journal.entries.some(
      (entry: {
        changes: {
          fields: { field: string; before: string; after: string }[];
        }[];
      }) =>
        entry.changes.some((change) =>
          change.fields.some(
            (field) =>
              field.field === "title" &&
              field.before.startsWith("Edited") &&
              field.after.startsWith("Edited"),
          ),
        ),
    ),
  );
});

test("trash enforces 72 hours, role and session boundaries, parent deletion is stored once and rollback is atomic", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  const path = `/sessions/${session.id}`;
  const group = newBlock("en", {
    kind: "group",
    title: "Whole group",
    children: [newBlock("en", { title: "Contained item" })],
  });
  session.days[0].blocks.push(group);
  session = (
    await h.owner.request(path, "PUT", { session, version: session.version })
  ).body.session;
  session.days[0].blocks = session.days[0].blocks.filter(
    (block) => block.id !== group.id,
  );
  session = (
    await h.owner.request(path, "PUT", { session, version: session.version })
  ).body.session;
  const trash = (await h.owner.request(path + "/deleted-elements")).body
    .elements;
  assert.equal(trash.length, 1);
  assert.equal(trash[0].kind, "block");
  const other = await h.session();
  assert.equal(
    (
      await h.owner.request(
        `/sessions/${other.id}/deleted-elements/${trash[0].id}/restore`,
        "POST",
        { version: other.version },
      )
    ).status,
    404,
  );
  const viewer = await h.account("history-trash-reader@example.test");
  await h.owner.request(path + "/members", "POST", {
    email: viewer.user.email,
    role: "viewer",
  });
  assert.equal(
    (
      await viewer.client.request(
        path + `/deleted-elements/${trash[0].id}/restore`,
        "POST",
        { version: session.version },
      )
    ).status,
    403,
  );
  assert.equal((await h.client().request(path + "/journal")).status, 401);
  const before = (await h.owner.request(path + "/journal")).body.entries.length;
  const rejected = await h.owner.request(
    path + `/deleted-elements/${trash[0].id}/restore`,
    "POST",
    { version: session.version - 1 },
  );
  assert.equal(rejected.status, 409);
  assert.equal(
    (await h.owner.request(path + "/journal")).body.entries.length,
    before,
  );
  await h.db.run("UPDATE deleted_elements SET expires_at=$1 WHERE id=$2", [
    new Date(Date.now() - 1000).toISOString(),
    trash[0].id,
  ]);
  assert.equal(
    (await h.owner.request(path + "/deleted-elements")).body.elements.length,
    0,
  );
  assert.equal(
    (
      await h.owner.request(
        path + `/deleted-elements/${trash[0].id}/restore`,
        "POST",
        { version: session.version },
      )
    ).status,
    410,
  );
  assert.equal(
    (await h.owner.request(path)).body.session.version,
    session.version,
  );
});

test("deleted days pages and forms restore individually without resurrecting public visibility", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  const path = `/sessions/${session.id}`;
  const day = {
    ...structuredClone(session.days[0]),
    id: crypto.randomUUID(),
    blocks: [newBlock("en")],
    title: "Deleted day",
  };
  const page = { ...newPage("en"), visibility: "public" as const };
  const form = newForm("en");
  session.days.push(day);
  session.pages = [page];
  session.forms = [form];
  session = (
    await h.owner.request(path, "PUT", { session, version: session.version })
  ).body.session;
  session.days = session.days.filter((value) => value.id !== day.id);
  session.pages = [];
  session.forms = [];
  session = (
    await h.owner.request(path, "PUT", { session, version: session.version })
  ).body.session;
  const deleted = (await h.owner.request(path + "/deleted-elements")).body
    .elements;
  assert.deepEqual(deleted.map((item: { kind: string }) => item.kind).sort(), [
    "day",
    "form",
    "page",
  ]);
  for (const item of deleted) {
    const restored = await h.owner.request(
      path + `/deleted-elements/${item.id}/restore`,
      "POST",
      { version: session.version },
    );
    assert.equal(restored.status, 200, JSON.stringify(restored.body));
    session = restored.body.session;
  }
  assert.equal(session.days.length, 2);
  assert.equal(session.pages?.[0].visibility, "team");
  assert.equal(session.forms?.[0].id, form.id);
});

test("restoring a deleted container does not duplicate children moved elsewhere in the same edit", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  const path = `/sessions/${session.id}`;
  const child = newBlock("en", { title: "Already moved elsewhere" }),
    lost = newBlock("en", { title: "Still recoverable" });
  const group = newBlock("en", {
    kind: "group",
    title: "Recover container",
    children: [child, lost],
  });
  session.days[0].blocks = [group];
  session = (
    await h.owner.request(path, "PUT", { session, version: session.version })
  ).body.session;
  session.days[0].blocks = [child];
  session = (
    await h.owner.request(path, "PUT", { session, version: session.version })
  ).body.session;
  const item = (
    await h.owner.request(path + "/deleted-elements")
  ).body.elements.find(
    (value: { title: string }) => value.title === group.title,
  );
  const restored = await h.owner.request(
    path + `/deleted-elements/${item.id}/restore`,
    "POST",
    { version: session.version },
  );
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
  const blocks = allBlocks(restored.body.session.days[0].blocks) as {
    id: string;
  }[];
  assert.equal(blocks.filter((block) => block.id === child.id).length, 1);
  assert.ok(blocks.some((block) => block.id === lost.id));
});
