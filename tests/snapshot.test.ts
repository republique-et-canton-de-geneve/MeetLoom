import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { harness, password } from "./support.js";
import {
  PRESERVED_TABLES,
  SNAPSHOT_TABLES,
  SnapshotError,
  TRANSIENT_TABLES,
  compress,
  decompress,
  decrypt,
  dialectOf,
  encrypt,
  listTables,
} from "../server/snapshot.js";

test("every table is either exported, transient or preserved", async (t) => {
  const h = await harness(t);
  const tables = await listTables(h.db, await dialectOf(h.db));
  const declared = new Set<string>([
    ...SNAPSHOT_TABLES,
    ...TRANSIENT_TABLES,
    ...PRESERVED_TABLES,
  ]);
  for (const table of tables)
    assert.ok(
      declared.has(table),
      `${table} must be listed in server/snapshot.ts`,
    );
  for (const table of declared)
    assert.ok(tables.includes(table), `${table} is declared but missing`);
});

test("archives are encrypted with the passphrase and refuse tampering and bombs", async () => {
  const snapshot = {
    format: "meetloom-data" as const,
    formatVersion: 1 as const,
    createdAt: new Date().toISOString(),
    app: { version: "1.0.0", revision: null },
    tables: { users: { columns: ["id"], rows: [["secret-marker"]] } },
  };
  const archive = await encrypt(compress(snapshot), "correct horse battery");
  assert.equal(archive.includes(Buffer.from("secret-marker")), false);
  const plain = await decrypt(archive, "correct horse battery");
  assert.deepEqual(decompress(plain, 1024 * 1024), snapshot);
  await assert.rejects(
    decrypt(archive, "wrong horse battery"),
    (error: SnapshotError) => error.code === "ARCHIVE_PASSPHRASE",
  );
  const tampered = Buffer.from(archive);
  tampered[40] ^= 1;
  await assert.rejects(
    decrypt(tampered, "correct horse battery"),
    (error: SnapshotError) => error.code === "ARCHIVE_PASSPHRASE",
  );
  await assert.rejects(
    decrypt(Buffer.from("not an archive at all, really not"), "x".repeat(12)),
    (error: SnapshotError) => error.code === "ARCHIVE_INVALID",
  );
  // 64 MiB of zeros compress to a few kilobytes.
  const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024));
  assert.throws(
    () => decompress(bomb, 1024 * 1024),
    (error: SnapshotError) => error.code === "ARCHIVE_TOO_LARGE",
  );
  assert.throws(
    () =>
      decompress(
        gzipSync(
          JSON.stringify({
            ...snapshot,
            tables: { users: { columns: ["id; DROP TABLE users"], rows: [] } },
          }),
        ),
        1024 * 1024,
      ),
    (error: SnapshotError) => error.code === "ARCHIVE_INVALID",
  );
});

test("an export imported elsewhere replaces its data, keeps passwords and signs everyone out", async (t) => {
  // Production: an owner, a member and a shared session with a comment.
  const source = await harness(t);
  await source.setup();
  const member = await source.account("member@example.test");
  const session = await source.session();
  const share = await source.owner.request(
    `/sessions/${session.id}/shares`,
    "POST",
    { label: "Room", mode: "agenda" },
  );
  assert.equal(share.status, 201);
  assert.equal(
    (
      await source.owner.request("/admin/data/export", "POST", {
        passphrase: "short",
        password,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await member.client.request("/admin/data/export", "POST", {
        passphrase: "a long enough passphrase",
        password,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await source.owner.request("/admin/data/export", "POST", {
        passphrase: "a long enough passphrase",
        password: "not my password",
      })
    ).body.code,
    "REAUTH_FAILED",
  );
  const exported = await source.owner.raw("/admin/data/export", "POST", {
    passphrase: "a long enough passphrase",
    password,
  });
  assert.equal(exported.status, 200);
  assert.match(
    exported.headers.get("content-disposition") ?? "",
    /attachment; filename="meetloom-.*\.mldx"/,
  );
  const archive = Buffer.from(await exported.arrayBuffer());

  // Development: another installation with its own data.
  const target = await harness(t);
  await target.setup();
  const devOnly = await target.session();
  const body = {
    archive: archive.toString("base64"),
    passphrase: "a long enough passphrase",
    password,
    confirm: "REMPLACER",
  };
  assert.equal(
    (
      await target.owner.request("/admin/data/import", "POST", {
        ...body,
        confirm: "oui",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await target.owner.request("/admin/data/import", "POST", {
        ...body,
        passphrase: "the wrong passphrase",
      })
    ).body.code,
    "ARCHIVE_PASSPHRASE",
  );
  const imported = await target.owner.request(
    "/admin/data/import",
    "POST",
    body,
  );
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.signedOut, true);
  // Everyone is signed out, the importing administrator included.
  assert.equal((await target.owner.request("/sessions")).status, 401);
  // Production accounts and passwords now work on development.
  const signIn = await target.owner.request("/auth/login", "POST", {
    email: "member@example.test",
    password,
  });
  assert.equal(signIn.status, 200, JSON.stringify(signIn.body));
  const owner = target.client();
  assert.equal(
    (
      await owner.request("/auth/login", "POST", {
        email: "owner@example.test",
        password,
      })
    ).status,
    200,
  );
  const sessions = (await owner.request("/sessions")).body.sessions as {
    id: string;
  }[];
  assert.ok(sessions.some((value) => value.id === session.id));
  assert.equal(
    sessions.some((value) => value.id === devOnly.id),
    false,
  );
  // Visitor links keep working after a move to another environment.
  assert.equal(
    (await target.client().request(`/public/${share.body.share.token}`)).status,
    200,
  );
  // The replaced development data can be brought back from the safety point.
  const backups = (await owner.request("/admin/backups")).body.backups as {
    id: string;
    kind: string;
  }[];
  assert.ok(
    backups.some(
      (backup) =>
        backup.id === imported.body.safetyBackup && backup.kind === "safety",
    ),
  );
  const [row] = await target.db.all<{ action: string }>(
    "SELECT action FROM audit_events WHERE action='data.import'",
  );
  assert.equal(row?.action, "data.import");
});
