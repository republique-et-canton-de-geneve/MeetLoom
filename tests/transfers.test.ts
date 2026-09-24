import { test } from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";
import { newBlock, allBlocks } from "../shared/domain.js";
import { removeTransferredContent } from "../shared/transfers.js";

test("copy between agendas preserves nested content and private audience with fresh IDs", async (t) => {
  const h = await harness(t);
  const owner = await h.setup();
  let source = await h.session();
  const destination = await h.session();
  source.days[0].blocks = [
    newBlock("en", {
      kind: "group",
      title: "Source group",
      children: [
        newBlock("en", {
          title: "Child",
          description: "PRIVATE_SCRIPT",
          assignees: [{ id: owner.id, name: owner.name }],
        }),
      ],
    }),
  ];
  source.columns.find((column) => column.id === "description")!.visibility =
    "team";
  source = (
    await h.owner.request(`/sessions/${source.id}`, "PUT", {
      session: source,
      version: source.version,
    })
  ).body.session;
  const result = await h.owner.request(
    `/sessions/${source.id}/transfer`,
    "POST",
    {
      sourceVersion: source.version,
      dayIds: [source.days[0].id],
      destinationId: destination.id,
      destinationVersion: destination.version,
      destinationDayId: destination.days[0].id,
    },
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.destination.days.length, 1);
  assert.equal(result.body.source.version, source.version);
  const imported = result.body.destination.days[0].blocks.at(-1);
  assert.equal(imported.title, "Source group");
  assert.notEqual(imported.id, source.days[0].blocks[0].id);
  assert.equal(imported.children[0].description, "");
  assert.equal(imported.children[0].assignees, undefined);
  assert.ok(
    imported.children[0].facilitator === "Owner" ||
      Object.values(imported.children[0].fields).includes("Owner"),
  );
  assert.ok(
    Object.values(imported.children[0].fields).includes("PRIVATE_SCRIPT"),
  );
  const link = (
    await h.owner.request(`/sessions/${destination.id}/shares`, "POST", {
      label: "Public",
    })
  ).body.share;
  assert.equal(
    JSON.stringify(
      (await h.client().request(`/public/${link.token}`)).body,
    ).includes("PRIVATE_SCRIPT"),
    false,
  );
});
test("moves enforce source/destination roles and stale versions leave both agendas intact", async (t) => {
  const h = await harness(t);
  await h.setup();
  const source = await h.session(),
    destination = await h.session(),
    viewer = await h.account("viewer@example.test");
  await h.owner.request(`/sessions/${source.id}/members`, "POST", {
    email: viewer.user.email,
    role: "viewer",
  });
  await h.owner.request(`/sessions/${destination.id}/members`, "POST", {
    email: viewer.user.email,
    role: "editor",
  });
  const command = {
    sourceVersion: source.version,
    dayIds: [source.days[0].id],
    blockIds: [source.days[0].blocks[0].id],
    destinationId: destination.id,
    destinationVersion: destination.version,
    destinationDayId: destination.days[0].id,
    mode: "move",
  };
  assert.equal(
    (
      await viewer.client.request(
        `/sessions/${source.id}/transfer`,
        "POST",
        command,
      )
    ).status,
    403,
  );
  const copied = await viewer.client.request(
    `/sessions/${source.id}/transfer`,
    "POST",
    { ...command, mode: "copy" },
  );
  assert.equal(copied.status, 200, JSON.stringify(copied.body));
  assert.equal(
    (await h.owner.request(`/sessions/${source.id}/transfer`, "POST", command))
      .status,
    409,
  );
  assert.equal(
    (await h.owner.request(`/sessions/${source.id}`)).body.session.days[0]
      .blocks.length,
    source.days[0].blocks.length,
  );
  const moved = await h.owner.request(
    `/sessions/${source.id}/transfer`,
    "POST",
    { ...command, destinationVersion: copied.body.destination.version },
  );
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(
    moved.body.source.days[0].blocks.length,
    source.days[0].blocks.length - 1,
  );
  const versions = await h.owner.request(`/sessions/${source.id}/versions`);
  assert.ok(versions.body.versions.length);
});

test("drop insertion validates the destination day and moves atomically before the target", async (t) => {
  const h = await harness(t);
  await h.setup();
  const source = await h.session(),
    destination = await h.session();
  const command = {
    sourceVersion: source.version,
    dayIds: [source.days[0].id],
    blockIds: [source.days[0].blocks[0].id],
    destinationId: destination.id,
    destinationVersion: destination.version,
    destinationDayId: destination.days[0].id,
    mode: "move",
  };
  const invalid = await h.owner.request(
    `/sessions/${source.id}/transfer`,
    "POST",
    { ...command, destinationBeforeBlockId: source.days[0].blocks[0].id },
  );
  assert.equal(invalid.status, 400);
  assert.equal(
    (await h.owner.request(`/sessions/${source.id}`)).body.session.version,
    source.version,
  );
  const moved = await h.owner.request(
    `/sessions/${source.id}/transfer`,
    "POST",
    { ...command, destinationBeforeBlockId: destination.days[0].blocks[1].id },
  );
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual(
    moved.body.destination.days[0].blocks.map(
      (b: { title: string }) => b.title,
    ),
    [
      destination.days[0].blocks[0].title,
      source.days[0].blocks[0].title,
      ...destination.days[0].blocks.slice(1).map((b) => b.title),
    ],
  );
  assert.equal(
    moved.body.source.days[0].blocks.length,
    source.days[0].blocks.length - 1,
  );
  assert.notEqual(
    moved.body.destination.days[0].blocks[1].id,
    source.days[0].blocks[0].id,
  );
});
test("extract day produces one standalone session and blocks active timer moves", async (t) => {
  const h = await harness(t);
  await h.setup();
  const source = await h.session(),
    path = `/sessions/${source.id}`;
  const extracted = await h.owner.request(path + "/transfer", "POST", {
    sourceVersion: source.version,
    dayIds: [source.days[0].id],
    newTitle: "Extracted day",
    mode: "copy",
  });
  assert.equal(extracted.status, 200, JSON.stringify(extracted.body));
  assert.equal(extracted.body.destination.days.length, 1);
  assert.equal(extracted.body.destination.title, "Extracted day");
  assert.equal(
    allBlocks(extracted.body.destination.days[0].blocks).length,
    allBlocks(source.days[0].blocks).length,
  );
  const run = (
    await h.owner.request(path + "/run", "POST", { action: "start" })
  ).body.session;
  const forbidden = await h.owner.request(path + "/transfer", "POST", {
    sourceVersion: run.version,
    dayIds: [source.days[0].id],
    blockIds: [source.days[0].blocks[0].id],
    newTitle: "Active move",
    mode: "move",
  });
  assert.equal(forbidden.status, 409);
  assert.equal(forbidden.body.code, "ACTIVE_BLOCK_REMOVED");
});
test("removing an idle first day resets its stale run reference to the retained day", async (t) => {
  const h = await harness(t);
  await h.setup();
  const source = await h.session();
  source.days.push({
    ...source.days[0],
    id: "day-two",
    blocks: [newBlock("en")],
  });
  const moved = removeTransferredContent(source, [source.days[0].id]);
  assert.equal(moved.days.length, 1);
  assert.equal(moved.run.dayId, "day-two");
});

test("a transfer rechecks source and destination access before writing its transaction", async (t) => {
  const h = await harness(t);
  await h.setup();
  const source = await h.session(),
    destination = await h.session(),
    collaborator = await h.account("transfer-editor@example.test");
  for (const session of [source, destination])
    await h.owner.request(`/sessions/${session.id}/members`, "POST", {
      email: collaborator.user.email,
      role: "editor",
    });
  const command = {
    sourceVersion: source.version,
    dayIds: [source.days[0].id],
    destinationId: destination.id,
    destinationVersion: destination.version,
    destinationDayId: destination.days[0].id,
    mode: "copy",
  };
  for (const side of ["source", "destination"] as const) {
    const original = h.db.transaction.bind(h.db),
      reached = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    let held = false;
    h.db.transaction = async (work) => {
      if (!held) {
        held = true;
        reached.resolve();
        await release.promise;
      }
      return original(work);
    };
    const pending = collaborator.client.request(
      `/sessions/${source.id}/transfer`,
      "POST",
      command,
    );
    try {
      await Promise.race([
        reached.promise,
        new Promise<never>((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Transfer transaction hook timed out")),
            5000,
          );
          timer.unref();
        }),
      ]);
      await h.db.run("DELETE FROM members WHERE session_id=$1 AND user_id=$2", [
        side === "source" ? source.id : destination.id,
        collaborator.user.id,
      ]);
    } finally {
      release.resolve();
      h.db.transaction = original;
    }
    assert.equal((await pending).status, side === "source" ? 404 : 403);
    assert.equal(
      (await h.owner.request(`/sessions/${destination.id}`)).body.session
        .version,
      destination.version,
    );
    await h.owner.request(
      `/sessions/${side === "source" ? source.id : destination.id}/members`,
      "POST",
      { email: collaborator.user.email, role: "editor" },
    );
  }
});
