import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";
import { log } from "../server/log.js";

test("administrators read the server logs of every pod without OpenShift", async (t) => {
  const h = await harness(t);
  await h.setup();
  const member = await h.account("member@example.test");
  const printed: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => printed.push(args);
  t.after(() => {
    console.warn = original;
  });
  log.warn("SMTP delivery failed", { code: "ECONNREFUSED" });
  log.error("Scheduled backup failed", { reason: "disk full" });
  log.info("MeetLoom started");
  // Still written to the standard output, where OpenShift collects it.
  assert.deepEqual(printed[0], [
    "SMTP delivery failed",
    { code: "ECONNREFUSED" },
  ]);
  await h.logs.flush();

  assert.equal((await member.client.request("/admin/logs")).status, 403);
  const all = (await h.owner.request("/admin/logs")).body;
  assert.deepEqual(
    all.logs
      .filter((entry: { message: string }) =>
        /SMTP delivery|backup failed|MeetLoom started/.test(entry.message),
      )
      .map((entry: { level: string }) => entry.level),
    ["info", "error", "warn"],
  );
  const entry = all.logs.find(
    (item: { message: string }) => item.message === "SMTP delivery failed",
  );
  assert.deepEqual(entry.details, { code: "ECONNREFUSED" });
  assert.ok(entry.pod);
  const problems = (await h.owner.request("/admin/logs?level=warn")).body.logs;
  assert.equal(
    problems.every((item: { level: string }) => item.level !== "info"),
    true,
  );
  const search = (await h.owner.request("/admin/logs?q=backup")).body.logs;
  assert.deepEqual(
    search.map((item: { message: string }) => item.message),
    ["Scheduled backup failed"],
  );
});

test("a failed request is logged with its method and path, never its query", async (t) => {
  const h = await harness(t);
  await h.setup();
  const original = console.error;
  console.error = () => {};
  t.after(() => {
    console.error = original;
  });
  // The database fails once: the request ends in the error handler.
  const all = h.db.all.bind(h.db);
  h.db.all = (async () => {
    h.db.all = all;
    throw new Error("connection terminated");
  }) as typeof h.db.all;
  assert.equal((await h.owner.request("/sessions?secret=1")).status, 500);
  await h.logs.flush();
  const [entry] = (await h.owner.request("/admin/logs?level=error")).body
    .logs as { message: string; details: Record<string, unknown> }[];
  assert.equal(entry.message, "Request failed");
  assert.deepEqual(entry.details, {
    method: "GET",
    path: "/api/sessions",
    error: "Error",
    reason: "connection terminated",
  });
  assert.equal(JSON.stringify(entry).includes("secret"), false);
});

test("old and surplus log lines are pruned", async (t) => {
  const h = await harness(t, { logs: { maxRows: 5, retentionDays: 7 } });
  await h.setup();
  const original = console.info;
  console.info = () => {};
  t.after(() => {
    console.info = original;
  });
  await h.db.run(
    "INSERT INTO server_logs(id,at,level,pod,message,details) VALUES('old',$1,'info','p','Too old',NULL)",
    [new Date(Date.now() - 8 * 86_400_000).toISOString()],
  );
  for (let index = 0; index < 8; index++) log.info(`line ${index}`);
  await h.logs.flush();
  await h.logs.prune();
  const rows = await h.db.all<{ message: string }>(
    "SELECT message FROM server_logs ORDER BY at DESC, id DESC",
  );
  assert.equal(rows.length, 5);
  assert.equal(
    rows.some((row) => row.message === "Too old"),
    false,
  );
  assert.equal(rows[0].message, "line 7");
});
