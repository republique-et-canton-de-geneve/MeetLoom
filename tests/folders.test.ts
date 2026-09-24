import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";

test("empty folders and parents persist with per-account isolation, hierarchy validation and CAS", async (t) => {
  const h = await harness(t);
  await h.setup();
  const other = await h.account("other@example.test");
  assert.equal((await h.owner.request("/folders")).body.version, 0);
  assert.equal(
    (
      await h.owner.request("/folders", "POST", {
        path: " Team / Workshops ",
        version: 0,
      })
    ).status,
    201,
  );
  let folders = (await h.owner.request("/folders")).body;
  assert.deepEqual(folders.folders, ["Team", "Team/Workshops"]);
  assert.equal((await other.client.request("/folders")).body.folders.length, 0);
  assert.equal(
    (await h.owner.request("/folders", "POST", { path: "Stale", version: 0 }))
      .status,
    409,
  );
  assert.equal(
    (
      await h.owner.request("/folders", "POST", {
        path: "../Unsafe",
        version: folders.version,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.owner.request("/folders", "PATCH", {
        source: "Team",
        path: "Team/Inside",
        version: folders.version,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await h.owner.request("/folders", "PATCH", {
        source: "Team",
        path: "Organization",
        version: folders.version,
      })
    ).status,
    200,
  );
  folders = (await h.owner.request("/folders")).body;
  assert.deepEqual(folders.folders, ["Organization", "Organization/Workshops"]);
  assert.equal(
    (
      await h.owner.request("/folders", "DELETE", {
        path: "Organization",
        version: folders.version,
      })
    ).status,
    200,
  );
  assert.deepEqual((await h.owner.request("/folders")).body.folders, []);
});

test("renaming a folder changes nested session classification atomically and empty source folders survive filing", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  assert.equal(
    (
      await h.owner.request(`/sessions/${session.id}`, "PUT", {
        version: session.version,
        session: { ...session, folder: "../Unsafe" },
      })
    ).status,
    400,
  );
  session = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      version: session.version,
      session: { ...session, folder: " A / Nested " },
    })
  ).body.session;
  let listing = (await h.owner.request("/folders")).body;
  assert.deepEqual(listing.folders, ["A", "A/Nested"]);
  assert.equal(
    (
      await h.owner.request("/folders", "DELETE", {
        path: "A",
        version: listing.version,
      })
    ).body.code,
    "FOLDER_NOT_EMPTY",
  );
  assert.equal(
    (
      await h.owner.request("/folders", "PATCH", {
        source: "A",
        path: "B",
        version: listing.version,
      })
    ).status,
    200,
  );
  const renamed = (await h.owner.request(`/sessions/${session.id}`)).body
    .session;
  assert.equal(renamed.folder, "B/Nested");
  assert.equal(renamed.version, session.version + 1);
  assert.equal(
    (
      await h.owner.request(`/sessions/${session.id}`, "PUT", {
        version: session.version,
        session: { ...session, title: "Stale" },
      })
    ).status,
    409,
  );
  session = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      version: renamed.version,
      session: { ...renamed, folder: "C" },
    })
  ).body.session;
  listing = (await h.owner.request("/folders")).body;
  assert.ok(listing.folders.includes("B/Nested"));
  assert.ok(listing.folders.includes("C"));
  assert.equal(
    (
      await h.owner.request("/folders", "DELETE", {
        path: "B",
        version: listing.version,
      })
    ).status,
    200,
  );
  assert.equal(
    (await h.owner.request(`/sessions/${session.id}`)).body.session.folder,
    "C",
  );
});

test("workspace folders inherit editor/read permissions without disclosing them to session guests", async (t) => {
  const h = await harness(t);
  await h.setup();
  const editor = await h.account("editor@example.test"),
    viewer = await h.account("viewer@example.test"),
    guest = await h.account("guest@example.test"),
    workspace = (await h.owner.request("/workspaces", "POST", { name: "Team" }))
      .body.workspace;
  for (const [person, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ] as const)
    await h.owner.request(`/workspaces/${workspace.id}/members`, "POST", {
      email: person.user.email,
      role,
    });
  const query = `/folders?workspaceId=${workspace.id}`;
  assert.equal(
    (
      await editor.client.request("/folders", "POST", {
        workspaceId: workspace.id,
        path: "Private/Future",
        version: 0,
      })
    ).status,
    201,
  );
  const current = (await viewer.client.request(query)).body;
  assert.deepEqual(current.folders, ["Private", "Private/Future"]);
  assert.equal(current.editable, false);
  assert.equal(
    (
      await viewer.client.request("/folders", "DELETE", {
        workspaceId: workspace.id,
        path: "Private",
        version: current.version,
      })
    ).status,
    403,
  );
  const session = (
    await h.owner.request("/sessions", "POST", {
      title: "Only shared",
      workspaceId: workspace.id,
    })
  ).body.session;
  await h.db.run(
    "INSERT INTO members(session_id,user_id,role) VALUES($1,$2,$3)",
    [session.id, guest.user.id, "viewer"],
  );
  assert.equal((await guest.client.request(query)).status, 404);
  assert.equal((await h.owner.request("/folders")).body.folders.length, 0);
});

test("concurrent folder changes commit once and a closed session can be organized without reopening it", async (t) => {
  const h = await harness(t);
  await h.setup();
  await h.owner.request("/folders", "POST", { path: "A", version: 0 });
  let listing = (await h.owner.request("/folders")).body;
  const outcomes = await Promise.all([
    h.owner.request("/folders", "PATCH", {
      source: "A",
      path: "B",
      version: listing.version,
    }),
    h.owner.request("/folders", "PATCH", {
      source: "A",
      path: "C",
      version: listing.version,
    }),
  ]);
  assert.deepEqual(outcomes.map((result) => result.status).sort(), [200, 409]);
  let s = await h.session();
  s = (
    await h.owner.request(`/sessions/${s.id}`, "PUT", {
      version: s.version,
      session: { ...s, folder: "Delivered" },
    })
  ).body.session;
  s = (
    await h.owner.request(`/sessions/${s.id}/lifecycle`, "POST", {
      action: "close",
      version: s.version,
    })
  ).body.session;
  listing = (await h.owner.request("/folders")).body;
  assert.equal(
    (
      await h.owner.request("/folders", "PATCH", {
        source: "Delivered",
        path: "Past",
        version: listing.version,
      })
    ).status,
    200,
  );
  const moved = (await h.owner.request(`/sessions/${s.id}`)).body.session;
  assert.equal(moved.folder, "Past");
  assert.ok(moved.lifecycle.closedAt);
});
