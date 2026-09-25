import test from "node:test";
import assert from "node:assert/strict";
import { harness, password } from "./support.js";
import { DEFAULT_SCHEDULE, latestSlot, nextSlot } from "../server/backups.js";

test("scheduled times follow the configured time zone across daylight saving", () => {
  const daily = { ...DEFAULT_SCHEDULE, mode: "daily" as const };
  // 02:00 in Geneva is 00:00 UTC in summer, 01:00 UTC in winter.
  assert.equal(
    new Date(
      latestSlot(daily, Date.parse("2026-07-10T08:00:00Z"))!,
    ).toISOString(),
    "2026-07-10T00:00:00.000Z",
  );
  assert.equal(
    new Date(
      latestSlot(daily, Date.parse("2026-01-10T00:30:00Z"))!,
    ).toISOString(),
    "2026-01-09T01:00:00.000Z",
  );
  const twice = { ...DEFAULT_SCHEDULE, mode: "twice" as const };
  assert.equal(
    new Date(
      nextSlot(twice, Date.parse("2026-07-10T08:00:00Z"))!,
    ).toISOString(),
    "2026-07-10T12:00:00.000Z",
  );
  assert.equal(latestSlot({ ...daily, mode: "off" }, Date.now()), null);
});

test("each scheduled time gives one backup, even with several application pods", async (t) => {
  const h = await harness(t);
  await h.setup();
  await h.session();
  const at = Date.parse("2026-07-10T08:00:00Z");
  // Two pods checking at the same time: only one takes the backup.
  const results = await Promise.all([
    h.backups.runScheduled(at),
    h.backups.runScheduled(at),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await h.backups.runScheduled(at + 60_000), false);
  // The next slot (02:00 the day after) takes another.
  assert.equal(
    await h.backups.runScheduled(Date.parse("2026-07-11T00:01:00Z")),
    true,
  );
  const listed = await h.owner.request("/admin/backups");
  assert.equal(listed.status, 200);
  const scheduled = (
    listed.body.backups as { kind: string; sessions: number }[]
  ).filter((backup) => backup.kind === "scheduled");
  assert.equal(scheduled.length, 2);
  assert.equal(scheduled[0].sessions, 1);
  // The listing never carries the data itself.
  assert.equal(JSON.stringify(listed.body).includes("payload"), false);

  // Retention keeps the configured number of scheduled backups.
  const saved = await h.owner.request("/admin/backups/settings", "PUT", {
    ...DEFAULT_SCHEDULE,
    keep: 1,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  // Saving starts the schedule from now: the next backup is a future one.
  assert.equal(await h.backups.runScheduled(Date.now() + 2 * 86_400_000), true);
  assert.equal(
    (await h.owner.request("/admin/backups")).body.backups.filter(
      (backup: { kind: string }) => backup.kind === "scheduled",
    ).length,
    1,
  );
  assert.equal(
    (
      await h.owner.request("/admin/backups/settings", "PUT", {
        ...DEFAULT_SCHEDULE,
        mode: "twice",
        times: ["02:00"],
      })
    ).status,
    400,
  );
});

test("a lost session comes back as a copy, and a full restore undoes later changes", async (t) => {
  const h = await harness(t);
  await h.setup();
  const member = await h.account("member@example.test");
  for (const path of ["/admin/backups", "/admin/data/export"])
    assert.equal((await member.client.request(path, "POST", {})).status, 403);
  const kept = await h.session();
  const checkpoint = await h.owner.request("/admin/backups", "POST", {
    label: "Avant la recette",
  });
  assert.equal(checkpoint.status, 201, JSON.stringify(checkpoint.body));
  const backupId = checkpoint.body.backup.id as string;
  assert.equal(checkpoint.body.backup.kind, "manual");
  assert.equal(checkpoint.body.backup.label, "Avant la recette");

  // Someone deletes the session for good after the checkpoint.
  await h.db.run("DELETE FROM sessions WHERE id=$1", [kept.id]);
  const later = await h.session();
  const contents = await h.owner.request(`/admin/backups/${backupId}/sessions`);
  assert.equal(contents.status, 200);
  assert.deepEqual(
    contents.body.sessions.map((value: { id: string; exists: boolean }) => [
      value.id,
      value.exists,
    ]),
    [[kept.id, false]],
  );
  const copy = await h.owner.request(
    `/admin/backups/${backupId}/sessions/${kept.id}/restore`,
    "POST",
    {},
  );
  assert.equal(copy.status, 201, JSON.stringify(copy.body));
  const restored = await h.owner.request(`/sessions/${copy.body.session.id}`);
  assert.equal(restored.status, 200);
  assert.equal(
    restored.body.session.days[0].blocks.length,
    kept.days[0].blocks.length,
  );
  assert.equal(restored.body.session.run.status, "idle");

  // A full restore needs the password and the typed confirmation.
  const restore = (body: Record<string, unknown>) =>
    h.owner.request(`/admin/backups/${backupId}/restore`, "POST", body);
  assert.equal(
    (await restore({ confirm: "REMPLACER" })).body.code,
    "REAUTH_FAILED",
  );
  assert.equal((await restore({ password })).status, 400);
  const done = await restore({ password, confirm: "REPLACE" });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal((await h.owner.request("/sessions")).status, 401);
  await h.owner.request("/auth/login", "POST", {
    email: "owner@example.test",
    password,
  });
  const ids = (await h.owner.request("/sessions")).body.sessions.map(
    (value: { id: string }) => value.id,
  );
  assert.deepEqual(ids, [kept.id]);
  assert.equal(ids.includes(later.id), false);
  // Backups survive a restore, including the safety point taken before it.
  const kinds = (await h.owner.request("/admin/backups")).body.backups.map(
    (value: { kind: string }) => value.kind,
  );
  assert.deepEqual(kinds.sort(), ["manual", "safety"]);
  const actions = (
    await h.db.all<{ action: string }>("SELECT action FROM audit_events")
  ).map((row) => row.action);
  assert.ok(actions.includes("backup.restore"));
  assert.ok(actions.includes("backup.create"));

  // Downloading a backup gives an encrypted archive importable elsewhere.
  const download = await h.owner.raw(
    `/admin/backups/${backupId}/download`,
    "POST",
    { password, passphrase: "a long enough passphrase" },
  );
  assert.equal(download.status, 200);
  assert.equal(
    Buffer.from(await download.arrayBuffer())
      .subarray(0, 4)
      .toString(),
    "MLDX",
  );
  assert.equal(
    (await h.owner.request(`/admin/backups/${backupId}`, "DELETE")).status,
    200,
  );
});
