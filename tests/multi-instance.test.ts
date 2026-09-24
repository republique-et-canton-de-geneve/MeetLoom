import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createApp } from "../server/app.js";
import { PresenceStore } from "../server/presence.js";

const postgresUrl = process.env.TEST_DATABASE_URL;

test(
  "several application pods start at once on a fresh PostgreSQL schema and share presence",
  { skip: postgresUrl ? false : "PostgreSQL only (TEST_DATABASE_URL)" },
  async (t) => {
    const schema = `meetloom_multi_${randomUUID().replaceAll("-", "")}`;
    const admin = new Pool({ connectionString: postgresUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    t.after(async () => {
      try {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      } finally {
        await admin.end();
      }
    });
    const url = new URL(postgresUrl!);
    url.searchParams.set("options", `-c search_path=${schema}`);
    // Without the startup lock, concurrent CREATE TABLE IF NOT EXISTS
    // statements race on PostgreSQL's catalog and one pod fails to start.
    const pods = await Promise.all(
      [1, 2, 3].map(() =>
        createApp({
          databaseUrl: url.href,
          origin: "https://meetloom.example.test",
          rateLimits: false,
        }),
      ),
    );
    t.after(() => Promise.all(pods.map((pod) => pod.close())));
    const [first, second] = pods.map((pod) => new PresenceStore(pod.db));
    await first.touch({
      sessionId: "one",
      userId: "owner",
      clientId: "tab",
      blockId: null,
      editing: false,
    });
    const seen = await second.list("one", [
      { userId: "owner", name: "Owner", role: "owner" },
    ]);
    assert.equal(seen.participants.length, 1);
  },
);
