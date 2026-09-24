import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";

test("read markers are private, monotone, permission checked and cannot acknowledge future edits", async (t) => {
  const h = await harness(t);
  await h.setup();
  const viewer = await h.account("viewer@example.test"),
    outsider = await h.account("outside@example.test");
  let session = await h.session();
  await h.db.run(
    "INSERT INTO members(session_id,user_id,role) VALUES($1,$2,$3)",
    [session.id, viewer.user.id, "viewer"],
  );
  assert.equal(
    (await h.owner.request("/sessions")).body.sessions[0].unreadActivity,
    false,
  );
  assert.equal(
    (await viewer.client.request("/sessions")).body.sessions[0].unreadActivity,
    true,
  );
  assert.equal(
    (
      await viewer.client.request(`/sessions/${session.id}/view`, "POST", {
        version: 99,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await outsider.client.request(`/sessions/${session.id}/view`, "POST", {
        version: 1,
      })
    ).status,
    404,
  );
  await viewer.client.request(`/sessions/${session.id}/view`, "POST", {
    version: session.version,
  });
  assert.equal(
    (await viewer.client.request("/sessions")).body.sessions[0].unreadActivity,
    false,
  );
  session = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session: { ...session, title: "Updated" },
      version: session.version,
    })
  ).body.session;
  assert.equal(
    (await viewer.client.request("/sessions")).body.sessions[0].unreadActivity,
    true,
  );
  await viewer.client.request(`/sessions/${session.id}/view`, "POST", {
    version: session.version,
  });
  await viewer.client.request(`/sessions/${session.id}/view`, "POST", {
    version: 1,
  });
  const read = (await viewer.client.request("/sessions")).body.sessions[0];
  assert.equal(read.unreadActivity, false);
  assert.ok(read.lastViewedAt);
  assert.equal(
    (await h.owner.request("/sessions")).body.sessions[0].unreadActivity,
    true,
  );
  await h.db.run("DELETE FROM members WHERE session_id=$1 AND user_id=$2", [
    session.id,
    viewer.user.id,
  ]);
  assert.equal(
    (
      await viewer.client.request(`/sessions/${session.id}/view`, "POST", {
        version: session.version,
      })
    ).status,
    404,
  );
});
