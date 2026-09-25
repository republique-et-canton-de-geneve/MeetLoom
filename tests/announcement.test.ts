import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";

test("an administrator's announcement reaches everyone, even before signing in, and disappears when emptied", async (t) => {
  const h = await harness(t);
  await h.setup();
  const member = await h.account("member@example.test");
  const visitor = h.client();
  assert.deepEqual((await visitor.request("/announcement")).body, {
    announcement: null,
  });
  assert.equal(
    (
      await member.client.request("/admin/announcement", "PUT", {
        message: "Maintenance",
        tone: "warning",
      })
    ).status,
    403,
  );
  const saved = await h.owner.request("/admin/announcement", "PUT", {
    message: "  Maintenance ce soir de 18 h à 19 h.  ",
    tone: "warning",
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  for (const client of [visitor, member.client]) {
    const { announcement } = (await client.request("/announcement")).body;
    assert.equal(announcement.message, "Maintenance ce soir de 18 h à 19 h.");
    assert.equal(announcement.tone, "warning");
    assert.ok(announcement.updatedAt);
  }
  assert.equal(
    (
      await h.owner.request("/admin/announcement", "PUT", {
        message: "x".repeat(501),
        tone: "info",
      })
    ).status,
    400,
  );
  await h.owner.request("/admin/announcement", "PUT", {
    message: "   ",
    tone: "info",
  });
  assert.deepEqual((await visitor.request("/announcement")).body, {
    announcement: null,
  });
  const actions = (
    await h.db.all<{ action: string }>("SELECT action FROM audit_events")
  ).map((row) => row.action);
  assert.equal(
    actions.filter((action) => action === "settings.announcement").length,
    2,
  );
});
