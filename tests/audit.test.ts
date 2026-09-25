import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harness } from "./support.js";
import { AUDIT_ACTIONS, audit } from "../server/audit.js";
import { DEFAULT_SOUND } from "../shared/model.js";

type Row = {
  action: string;
  actor_id: string | null;
  target: string | null;
  detail: string;
  ip: string | null;
};

test("privileged actions leave an audit row with actor, target and client address, and no secret", async (t) => {
  const h = await harness(t, { trustProxy: 1 });
  const owner = await h.setup();
  const address = { "X-Forwarded-For": "198.51.100.7" };
  assert.equal(
    (
      await h.owner.request(
        "/admin/settings/signup",
        "PUT",
        { enabled: false, domains: [] },
        address,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await h.owner.request(
        "/settings",
        "PUT",
        { sound: { ...DEFAULT_SOUND, value: 3 } },
        address,
      )
    ).status,
    200,
  );
  const guest = await h.account("guest@example.test");
  const updated = await h.owner.request(
    `/admin/accounts/${guest.user.id}`,
    "PATCH",
    { disabled: true },
    address,
  );
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  await h.owner.request(
    `/admin/accounts/${guest.user.id}`,
    "PATCH",
    { disabled: false },
    address,
  );
  const reset = await h.owner.request(
    `/admin/accounts/${guest.user.id}/reset`,
    "POST",
    {},
    address,
  );
  assert.equal(reset.status, 201, JSON.stringify(reset.body));
  assert.equal(
    (
      await h.owner.request(
        `/admin/accounts/${guest.user.id}/access`,
        "DELETE",
        undefined,
        address,
      )
    ).status,
    200,
  );
  const rows = await h.db.all<Row>(
    "SELECT action,actor_id,target,detail,ip FROM audit_events ORDER BY at,id",
  );
  const actions = rows.map((row) => row.action);
  // Backup and data-transfer actions are covered by their own tests.
  for (const action of AUDIT_ACTIONS.filter(
    (value) => !/^(backup|data)\.|^settings\.backups$/.test(value),
  ))
    assert.ok(actions.includes(action), `${action} is recorded`);
  const setup = rows.find((row) => row.action === "installation.setup")!;
  assert.equal(setup.actor_id, owner.id);
  const signup = rows.find((row) => row.action === "settings.signup")!;
  assert.equal(signup.actor_id, owner.id);
  assert.equal(signup.ip, "198.51.100.7");
  assert.deepEqual(JSON.parse(signup.detail), {
    enabled: false,
    domains: 0,
  });
  const disabled = rows.filter((row) => row.action === "account.update");
  assert.equal(disabled[0].target, guest.user.id);
  assert.deepEqual(JSON.parse(disabled[0].detail), { disabled: true });
  const serialized = JSON.stringify(rows);
  assert.equal(serialized.includes(reset.body.token ?? "no-token"), false);
  assert.equal(serialized.includes("password"), false);
});

test("an unknown audit action is refused, and every declared action is emitted by a route", async () => {
  await assert.rejects(
    () =>
      audit(
        { all: async () => [], run: async () => 0 },
        {} as never,
        { locals: {} } as never,
        "account.typo" as never,
      ),
    /Unknown audit action/,
  );
  const sources = ["server/app.ts", "server/accounts.ts", "server/backups.ts"]
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  for (const action of AUDIT_ACTIONS)
    assert.ok(sources.includes(`"${action}"`), `${action} has an emitter`);
});
