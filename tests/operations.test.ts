import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { harness } from "./support.js";
import { appVersion } from "../server/version.js";

test("the installed version comes from the image, else from package.json", () => {
  const packaged = JSON.parse(readFileSync("package.json", "utf8")).version;
  assert.deepEqual(appVersion({}), { version: packaged, revision: null });
  assert.deepEqual(
    appVersion({
      APP_VERSION: " 0.2.0-rc.1 ",
      APP_REVISION: "0123456789abcdef0123456789abcdef01234567",
    }),
    {
      version: "0.2.0-rc.1",
      revision: "0123456789abcdef0123456789abcdef01234567",
    },
  );
  // Anything that is not a version or a commit is ignored.
  assert.deepEqual(
    appVersion({ APP_VERSION: "<script>", APP_REVISION: "main" }),
    { version: packaged, revision: null },
  );
});

test("every signed-in account can read the installed version", async (t) => {
  const h = await harness(t, {
    version: { version: "9.8.7", revision: "abcdef1" },
  });
  await h.setup();
  assert.equal((await h.client().request("/about")).status, 401);
  const member = await h.account("member@example.test");
  const about = await member.client.request("/about");
  assert.equal(about.status, 200);
  assert.deepEqual(about.body, { version: "9.8.7", revision: "abcdef1" });
});

test("administrators see sessions being run, edited or followed before an update", async (t) => {
  const h = await harness(t, { version: { version: "1.2.3", revision: null } });
  await h.setup();
  const member = await h.account("member@example.test");
  assert.equal((await member.client.request("/admin/activity")).status, 403);

  const quiet = await h.owner.request("/admin/activity");
  assert.equal(quiet.status, 200);
  assert.equal(quiet.body.version, "1.2.3");
  assert.deepEqual(quiet.body.sessions, []);

  // A running timer.
  const running = await h.session();
  const started = await h.owner.request(`/sessions/${running.id}/run`, "POST", {
    action: "start",
    version: running.version,
  });
  assert.equal(started.status, 200, JSON.stringify(started.body));
  // A session still open in an editor, then moved to the trash: not listed.
  const trashed = await h.session();
  await h.owner.request(`/sessions/${trashed.id}/presence`, "POST", {
    clientId: crypto.randomUUID(),
    editing: true,
  });
  assert.equal(
    (
      await h.owner.request(`/sessions/${trashed.id}/trash`, "POST", {
        version: trashed.version,
      })
    ).status,
    200,
  );
  // A session only being edited, and followed through a visitor link.
  const edited = await h.session();
  await h.owner.request(`/sessions/${edited.id}/presence`, "POST", {
    clientId: crypto.randomUUID(),
    editing: true,
  });
  const share = await h.owner.request(`/sessions/${edited.id}/shares`, "POST", {
    label: "Room",
    mode: "agenda",
  });
  assert.equal(share.status, 201, JSON.stringify(share.body));
  const visitor = h.client();
  assert.equal(
    (await visitor.request(`/public/${share.body.share.token}`)).status,
    200,
  );
  // An idle session nobody has open is not listed.
  await h.session();

  const activity = await h.owner.request("/admin/activity");
  assert.equal(activity.status, 200);
  const sessions = activity.body.sessions as {
    id: string;
    title: string;
    owner: string;
    timer: { status: string; block: string | null } | null;
    editors: number;
    visitorLinks: number;
  }[];
  assert.deepEqual(
    sessions.map((entry) => entry.id),
    [running.id, edited.id],
  );
  const [live, editing] = sessions;
  assert.equal(live.timer?.status, "running");
  const block = started.body.session.run.blockId;
  assert.equal(
    live.timer?.block,
    running.days[0].blocks.find((value) => value.id === block)?.title,
  );
  assert.equal(live.owner, "Owner");
  assert.equal(editing.timer, null);
  assert.equal(editing.editors, 1);
  assert.equal(editing.visitorLinks, 1);
  assert.equal(typeof activity.body.checkedAt, "number");
});
