import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";

type Item = {
  id: string;
  kind: string;
  count?: number;
  actor: string;
  sessionId: string | null;
  commentId: string | null;
  readAt: string | null;
};
const inbox = async (client: {
  request: (path: string) => Promise<{ body: unknown }>;
}) =>
  (await client.request("/notifications")).body as {
    notifications: Item[];
    unread: number;
  };

test("visitor comments notify the organizers once per session until read, not once per message", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session();
  const editor = await h.account("editor@example.test");
  const viewer = await h.account("viewer@example.test");
  for (const [who, role] of [
    [editor, "editor"],
    [viewer, "viewer"],
  ] as const)
    await h.owner.request(`/sessions/${session.id}/members`, "POST", {
      email: who.user.email,
      role,
    });
  const token = (
    await h.owner.request(`/sessions/${session.id}/shares`, "POST", {
      label: "Room",
      mode: "visitor",
      allowComments: true,
    })
  ).body.share.token as string;
  const visitor = h.client();
  const post = (author: string, text: string, parentId?: string) =>
    visitor.request(`/public/${token}/comments`, "POST", {
      author,
      text,
      ...(parentId ? { parentId } : {}),
    });
  const first = (await post("Toto", "Une question")).body.comment;
  await post("Lou", "Une autre");
  await post("Toto", "Précision", first.id);

  const owner = await inbox(h.owner);
  const grouped = owner.notifications.filter(
    (item) => item.kind === "visitor-comments",
  );
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].count, 3);
  assert.equal(grouped[0].actor, "Toto");
  assert.equal(grouped[0].sessionId, session.id);
  assert.equal(grouped[0].commentId, first.id);
  assert.equal(owner.unread, 1);
  assert.equal(
    (await inbox(editor.client)).notifications.filter(
      (item) => item.kind === "visitor-comments",
    ).length,
    1,
  );
  // Viewers do not answer visitors.
  assert.equal((await inbox(viewer.client)).notifications.length, 0);

  // A team reply is not news for the team.
  await h.owner.request(
    `/sessions/${session.id}/visitor-comments/${first.id}/replies`,
    "POST",
    { text: "Réponse" },
  );
  assert.equal((await inbox(h.owner)).notifications[0].count, 3);

  // Once read, the next comment starts a new notification.
  await h.owner.request("/notifications/read", "POST", {
    ids: [grouped[0].id],
  });
  assert.equal((await inbox(h.owner)).unread, 0);
  await post("Lou", "Encore une");
  const after = await inbox(h.owner);
  assert.equal(after.unread, 1);
  assert.equal(
    after.notifications.filter((item) => item.kind === "visitor-comments")
      .length,
    2,
  );
  await h.owner.request("/notifications/read", "POST", { all: true });
  assert.equal((await inbox(h.owner)).unread, 0);
});

test("a problem report notifies the other administrators, grouped", async (t) => {
  const h = await harness(t);
  await h.setup();
  const second = await h.account("second-admin@example.test");
  const member = await h.account("member@example.test");
  await h.owner.request(`/admin/accounts/${second.user.id}`, "PATCH", {
    isAdmin: true,
  });
  await member.client.request("/feedback", "POST", {
    kind: "bug",
    message: "Le bouton ne répond pas.",
  });
  await member.client.request("/feedback", "POST", {
    kind: "idea",
    message: "Un mode sombre.",
  });
  for (const client of [h.owner, second.client]) {
    const [item] = (await inbox(client)).notifications;
    assert.equal(item.kind, "feedback");
    assert.equal(item.count, 2);
    assert.equal(item.sessionId, null);
  }
  assert.equal((await inbox(member.client)).notifications.length, 0);
  // An administrator's own report does not notify them.
  await h.owner.request("/notifications/read", "POST", { all: true });
  await h.owner.request("/feedback", "POST", {
    kind: "other",
    message: "Note",
  });
  assert.equal((await inbox(h.owner)).unread, 0);
  assert.equal((await inbox(second.client)).notifications[0].count, 3);
});
