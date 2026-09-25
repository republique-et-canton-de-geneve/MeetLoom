import { test } from "node:test";
import assert from "node:assert/strict";
import { harness, password } from "./support.js";
import { decompress, decrypt } from "../server/snapshot.js";
import { newBlock } from "../shared/domain.js";

test("share scopes and simple agendas are projected on server, including nested fields and run", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  const first = session.days[0];
  first.blocks[0].fields.notes = "PRIVATE_NOTE";
  session.days.push({
    ...structuredClone(first),
    id: "secret-day",
    title: "PRIVATE_DAY",
    blocks: [newBlock("en", { title: "PRIVATE_BLOCK" })],
  });
  session.pages = [
    {
      id: "public-page",
      title: "Public context",
      visibility: "public",
      sections: [{ id: "p-content", content: "Public page text" }],
    },
    {
      id: "private-page",
      title: "PRIVATE_PAGE",
      visibility: "team",
      sections: [{ id: "s-content", content: "PRIVATE_SECTION" }],
    },
  ];
  session = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session,
      version: session.version,
    })
  ).body.session;
  const link = (
    await h.owner.request(`/sessions/${session.id}/shares`, "POST", {
      label: "Scoped",
      dayIds: [first.id],
      pageIds: [],
      initialDayId: first.id,
      allowComments: true,
    })
  ).body.share;
  assert.ok(link.token);
  const guest = h.client();
  let result = await guest.request(`/public/${link.token}`);
  assert.equal(result.status, 200);
  assert.equal(JSON.stringify(result.body).includes("PRIVATE_"), false);
  assert.equal(result.body.session.days.length, 1);
  assert.deepEqual(result.body.session.pages, []);
  assert.equal(result.body.sharing.initialDayId, first.id);
  const wrong = await h.owner.request(
    `/sessions/${session.id}/shares`,
    "POST",
    { label: "Invalid", dayIds: [first.id], initialDayId: "secret-day" },
  );
  assert.equal(wrong.status, 400);
  const privatePage = await h.owner.request(
    `/sessions/${session.id}/shares`,
    "POST",
    { label: "Invalid page", pageIds: ["private-page"] },
  );
  assert.equal(privatePage.status, 400);
  await h.owner.request(`/sessions/${session.id}/run`, "POST", {
    action: "start",
    dayId: "secret-day",
  });
  result = await guest.request(`/public/${link.token}`);
  assert.equal(result.body.session.run.status, "idle");
  assert.equal(JSON.stringify(result.body).includes("PRIVATE_"), false);
  const simple = (
    await h.owner.request(`/sessions/${session.id}/shares`, "POST", {
      label: "Simple",
      mode: "agenda",
      dayIds: [first.id],
      allowComments: true,
    })
  ).body.share;
  const agenda = await guest.request(`/public/${simple.token}`);
  assert.deepEqual(agenda.body.session.columns, []);
  assert.equal(agenda.body.session.days[0].blocks[0].description, undefined);
  assert.equal(agenda.body.session.pages, undefined);
  assert.equal(agenda.body.session.contentOrder, undefined);
  assert.equal(agenda.body.sharing.allowComments, false);
  assert.equal(
    (await guest.request(`/public/${simple.token}/comments`)).status,
    403,
  );
  // Owners can copy an address again (sealed at rest, see the test below).
  assert.ok(
    JSON.stringify(
      (await h.owner.request(`/sessions/${session.id}/shares`)).body,
    ).includes(link.token),
  );
});

test("guest discussions remain scoped to link, never expose private comments and support team replies/resolution/revocation", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session(),
    path = `/sessions/${session.id}`,
    blockId = session.days[0].blocks[0].id;
  await h.owner.request(path + "/comments", "POST", {
    blockId,
    text: "PRIVATE_TEAM_DISCUSSION",
  });
  const create = async () =>
    (
      await h.owner.request(path + "/shares", "POST", {
        label: "Visitor",
        allowComments: true,
      })
    ).body.share;
  const first = await create(),
    second = await create(),
    guest = h.client(),
    url = `/public/${first.token}/comments`;
  const posted = await guest.request(url, "POST", {
    author: "Camille",
    text: "A public question",
    blockId,
  });
  assert.equal(posted.status, 201);
  assert.equal(
    (
      await guest.request(url, "POST", {
        author: "Camille",
        text: "X",
        blockId: "secret-block",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await guest.request(`/public/${second.token}/comments`, "POST", {
        author: "Someone",
        text: "Cross-link reply",
        parentId: posted.body.comment.id,
      })
    ).status,
    400,
  );
  const listed = await guest.request(url);
  assert.equal(listed.body.comments.length, 1);
  assert.equal(JSON.stringify(listed.body).includes("PRIVATE_TEAM"), false);
  const stranger = await h.account("stranger@example.test");
  assert.equal(
    (await stranger.client.request(path + "/visitor-comments")).status,
    404,
  );
  assert.equal((await guest.request(path + "/visitor-comments")).status, 401);
  assert.equal(
    (
      await h.owner.request(
        path + `/visitor-comments/${posted.body.comment.id}/replies`,
        "POST",
        { text: "The team answers" },
      )
    ).status,
    201,
  );
  assert.equal((await guest.request(url)).body.comments.length, 2);
  assert.equal(
    (
      await h.owner.request(
        path + `/visitor-comments/${posted.body.comment.id}`,
        "PATCH",
        { resolved: true },
      )
    ).status,
    200,
  );
  assert.equal((await guest.request(url)).body.comments[0].resolved, true);
  assert.equal(
    (
      await h.owner.request(path + `/shares/${first.id}`, "PATCH", {
        enabled: false,
      })
    ).status,
    200,
  );
  assert.equal((await guest.request(url)).status, 404);
  const disabled = (await h.owner.request(path + "/shares")).body.shares.find(
    (share: { id: string }) => share.id === first.id,
  );
  assert.equal(disabled.allowComments, true);
  assert.equal(disabled.mode, "visitor");
  assert.equal(
    (
      await h.owner.request(path + `/shares/${first.id}`, "PATCH", {
        enabled: true,
      })
    ).status,
    200,
  );
  assert.equal((await guest.request(url)).body.comments.length, 2);
  assert.equal(
    (await h.owner.request(path + `/shares/${first.id}`, "DELETE", {})).status,
    200,
  );
  assert.equal((await guest.request(url)).status, 404);
  assert.equal(
    (await h.owner.request(path + "/visitor-comments")).body.comments.length,
    2,
  );
});

test("concurrent share patches preserve independent options under the session lock", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session(),
    path = `/sessions/${session.id}/shares`;
  const link = (
    await h.owner.request(path, "POST", {
      label: "Original",
      allowComments: false,
    })
  ).body.share;
  const updates = await Promise.all([
    h.owner.request(`${path}/${link.id}`, "PATCH", { label: "Renamed" }),
    h.owner.request(`${path}/${link.id}`, "PATCH", { allowComments: true }),
  ]);
  for (const result of updates)
    assert.equal(result.status, 200, JSON.stringify(result.body));
  const stored = (await h.owner.request(path)).body.shares.find(
    (value: { id: string }) => value.id === link.id,
  );
  assert.equal(stored.label, "Renamed");
  assert.equal(stored.allowComments, true);
});

test("a link initial content can be explicitly reset while omitted options are retained", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session(),
    path = `/sessions/${session.id}/shares`;
  const link = (
    await h.owner.request(path, "POST", {
      label: "Initial content",
      initialContentId: session.days[0].id,
      initialDayId: session.days[0].id,
    })
  ).body.share;
  assert.equal(
    (
      await h.owner.request(`${path}/${link.id}`, "PATCH", {
        initialContentId: null,
        initialDayId: null,
      })
    ).status,
    200,
  );
  const visitor = await h.client().request(`/public/${link.token}`);
  assert.equal(visitor.body.sharing.initialContentId, null);
  assert.equal(visitor.body.sharing.initialDayId, null);
});

test("owners can copy a visitor link again, and its address never leaves the installation", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  const created = (
    await h.owner.request(`/sessions/${session.id}/shares`, "POST", {
      label: "Room",
    })
  ).body.share;
  const listed = async (client = h.owner) =>
    (await client.request(`/sessions/${session.id}/shares`)).body.shares as {
      id: string;
      token: string | null;
    }[];
  assert.equal((await listed())[0].token, created.token);
  // Stored sealed, not in clear.
  const stored = JSON.stringify(await h.db.all("SELECT * FROM share_secrets"));
  assert.equal(stored.includes(created.token), false);
  // Editors cannot list links, so they cannot read addresses either.
  const editor = await h.account("editor@example.test");
  await h.owner.request(`/sessions/${session.id}/members`, "POST", {
    email: "editor@example.test",
    role: "editor",
  });
  assert.equal(
    (await editor.client.request(`/sessions/${session.id}/shares`)).status,
    403,
  );

  // An export carries the link but not a readable address.
  const exported = await h.owner.raw("/admin/data/export", "POST", {
    passphrase: "a long enough passphrase",
    password,
  });
  const archive = Buffer.from(await exported.arrayBuffer());
  const snapshot = decompress(
    await decrypt(archive, "a long enough passphrase"),
    64 * 1024 * 1024,
  );
  assert.equal(JSON.stringify(snapshot).includes(created.token), false);
  const target = await harness(t);
  await target.setup();
  assert.equal(
    (
      await target.owner.request("/admin/data/import", "POST", {
        archive: archive.toString("base64"),
        passphrase: "a long enough passphrase",
        password,
        confirm: "REMPLACER",
      })
    ).status,
    200,
  );
  const owner = target.client();
  await owner.request("/auth/login", "POST", {
    email: "owner@example.test",
    password,
  });
  const moved = (
    await owner.request(`/sessions/${session.id}/shares`)
  ).body.shares[0];
  assert.equal(moved.token, null);
  // A new address replaces it; the old one stops working.
  const renewed = await owner.request(
    `/sessions/${session.id}/shares/${moved.id}/renew`,
    "POST",
    {},
  );
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.notEqual(renewed.body.token, created.token);
  assert.equal(
    (await target.client().request(`/public/${created.token}`)).status,
    404,
  );
  assert.equal(
    (await target.client().request(`/public/${renewed.body.token}`)).status,
    200,
  );
  assert.equal(
    (await owner.request(`/sessions/${session.id}/shares`)).body.shares[0]
      .token,
    renewed.body.token,
  );
});
