import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "../src/RichText.js";
import { randomUUID } from "node:crypto";
import { harness } from "./support.js";
import {
  serializeRichText,
  richTextMentions,
  richTextToPlain,
  parseRichText,
} from "../shared/richtext.js";
import { installCommentsApi } from "../server/comments.js";
import type { Session } from "../shared/model.js";

const mention = (id: string, label = "Collaborator", checked?: boolean) =>
  serializeRichText({
    type: "doc",
    content: [
      checked === undefined
        ? {
            type: "paragraph",
            content: [{ type: "mention", attrs: { id, label } }],
          }
        : {
            type: "taskList",
            content: [
              {
                type: "taskItem",
                attrs: { checked },
                content: [
                  {
                    type: "paragraph",
                    content: [
                      { type: "text", text: "Prepare " },
                      { type: "mention", attrs: { id, label } },
                    ],
                  },
                ],
              },
            ],
          },
    ],
  });

test("private comments support viewer threads, explicit mentions and scoped collaborator names", async (t) => {
  const h = await harness(t),
    owner = await h.setup(),
    session = await h.session(),
    viewer = await h.account("viewer@example.test"),
    outsider = await h.account("outsider@example.test");
  await h.owner.request(`/sessions/${session.id}/members`, "POST", {
    email: viewer.user.email,
    role: "viewer",
  });
  const members = await viewer.client.request(
    `/sessions/${session.id}/collaborators`,
  );
  assert.equal(members.status, 200);
  assert.equal(members.body.collaborators.length, 2);
  assert.equal(JSON.stringify(members.body).includes("@example.test"), true); // Names may be email-looking; no separate email field is returned.
  assert.ok(
    members.body.collaborators.every((member: any) => !("email" in member)),
  );
  assert.equal(
    (await outsider.client.request(`/sessions/${session.id}/collaborators`))
      .status,
    404,
  );
  assert.equal(
    (await h.client().request(`/sessions/${session.id}/comments`)).status,
    401,
  );
  const created = await viewer.client.request(
    `/sessions/${session.id}/comments`,
    "POST",
    {
      text: "Please review @Owner",
      mentions: [owner.id],
      blockId: session.days[0].blocks[0].id,
    },
  );
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.comment.authorId, viewer.user.id);
  assert.equal(created.body.thread.comments.length, 1);
  assert.equal(created.body.comment.mentions[0].id, owner.id);
  assert.equal(
    (
      await viewer.client.request(`/sessions/${session.id}/comments`, "POST", {
        text: "Invalid mention",
        mentions: [outsider.user.id],
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await viewer.client.request(`/sessions/${session.id}/comments`, "POST", {
        text: "Spoof",
        authorId: owner.id,
      })
    ).status,
    400,
  );
  const inbox = await h.owner.request("/notifications");
  assert.equal(inbox.status, 200);
  assert.equal(inbox.body.unread, 1);
  assert.equal(inbox.body.notifications[0].kind, "mention");
  assert.equal(inbox.body.notifications[0].commentId, created.body.comment.id);
  assert.equal((await viewer.client.request("/notifications")).body.unread, 0);
  assert.equal(
    (
      await outsider.client.request(
        `/sessions/${session.id}/comments/${created.body.comment.id}`,
      )
    ).status,
    404,
  );
  const share = await h.owner.request(
    `/sessions/${session.id}/shares`,
    "POST",
    { label: "Visitors" },
  );
  const publicResult = await h
    .client()
    .request(`/public/${share.body.share.token}`);
  assert.equal(publicResult.status, 200);
  assert.equal(
    JSON.stringify(publicResult.body).includes("Please review"),
    false,
  );
});

test("replies inherit their root block, resolution uses CAS and cross-session roots are rejected", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session(),
    other = await h.session(),
    blockId = session.days[0].blocks[0].id;
  const root = (
    await h.owner.request(`/sessions/${session.id}/comments`, "POST", {
      text: "Question",
      blockId,
    })
  ).body.thread;
  const reply = await h.owner.request(
    `/sessions/${session.id}/comments`,
    "POST",
    { text: "Answer", parentId: root.id },
  );
  assert.equal(reply.status, 201);
  assert.equal(reply.body.comment.blockId, blockId);
  assert.equal(reply.body.thread.revision, 1);
  assert.equal(reply.body.thread.comments[0].id, root.id);
  assert.deepEqual(
    (await h.owner.request(`/sessions/${session.id}/comment-counts`)).body,
    { total: 2, session: 0, blocks: { [blockId]: 2 } },
  );
  assert.equal(
    (
      await h.owner.request(`/sessions/${other.id}/comments`, "POST", {
        text: "Bad parent",
        parentId: root.id,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await h.owner.request(
        `/sessions/${session.id}/comments/${root.id}`,
        "PATCH",
        { resolved: true, revision: 0 },
      )
    ).status,
    409,
  );
  const resolved = await h.owner.request(
    `/sessions/${session.id}/comments/${root.id}`,
    "PATCH",
    { resolved: true, revision: 1 },
  );
  assert.equal(resolved.status, 200);
  assert.ok(resolved.body.thread.resolvedAt);
  assert.equal(
    (
      await h.owner.request(`/sessions/${session.id}/comments`, "POST", {
        text: "Too late",
        parentId: root.id,
      })
    ).body.code,
    "THREAD_RESOLVED",
  );
  assert.equal(
    (await h.owner.request(`/sessions/${session.id}/comments?status=open`)).body
      .total,
    0,
  );
  assert.equal(
    (await h.owner.request(`/sessions/${session.id}/comment-counts`)).body
      .total,
    0,
  );
  assert.equal(
    (await h.owner.request(`/sessions/${session.id}/comments?status=resolved`))
      .body.total,
    1,
  );
  const reopened = await h.owner.request(
    `/sessions/${session.id}/comments/${root.id}`,
    "PATCH",
    { resolved: false, revision: 2 },
  );
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.thread.resolvedAt, null);
  assert.equal(
    (
      await h.owner.request(
        `/sessions/${other.id}/comments/${root.id}`,
        "PATCH",
        { resolved: true, revision: 3 },
      )
    ).status,
    404,
  );
});

test("notification read state belongs to its recipient and disappears immediately after access revocation", async (t) => {
  const h = await harness(t);
  await h.setup();
  const session = await h.session(),
    member = await h.account("member@example.test");
  await h.owner.request(`/sessions/${session.id}/members`, "POST", {
    email: member.user.email,
    role: "editor",
  });
  await h.owner.request(`/sessions/${session.id}/comments`, "POST", {
    text: "For the team",
  });
  const inbox = await member.client.request("/notifications"),
    notification = inbox.body.notifications[0];
  assert.equal(inbox.body.unread, 1);
  assert.equal(notification.kind, "comment");
  await h.owner.request("/notifications/read", "POST", {
    ids: [notification.id],
  });
  assert.equal((await member.client.request("/notifications")).body.unread, 1);
  await member.client.request("/notifications/read", "POST", {
    ids: [notification.id],
  });
  assert.equal((await member.client.request("/notifications")).body.unread, 0);
  await h.owner.request(
    `/sessions/${session.id}/members/${member.user.id}`,
    "DELETE",
    {},
  );
  assert.deepEqual((await member.client.request("/notifications")).body, {
    notifications: [],
    unread: 0,
  });
  assert.equal(
    (await member.client.request(`/sessions/${session.id}/comments`)).status,
    404,
  );
});

test("block mentions notify once after a successful CAS, preserve recipient boundaries and support completed tasks", async (t) => {
  const h = await harness(t);
  await h.setup();
  let session = await h.session();
  const member = await h.account("member@example.test"),
    outsider = await h.account("outsider@example.test");
  await h.owner.request(`/sessions/${session.id}/members`, "POST", {
    email: member.user.email,
    role: "viewer",
  });
  async function save(next: Session) {
    const response = await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session: next,
      version: session.version,
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    session = response.body.session;
  }
  const next = structuredClone(session);
  next.days[0].blocks[0].description = mention(member.user.id);
  await save(next);
  let inbox = await member.client.request("/notifications");
  assert.equal(inbox.body.unread, 1);
  assert.equal(inbox.body.notifications[0].kind, "block-mention");
  const stale = structuredClone(session);
  stale.days[0].blocks[0].description = mention(outsider.user.id);
  assert.equal(
    (
      await h.owner.request(`/sessions/${session.id}`, "PUT", {
        session: stale,
        version: session.version - 1,
      })
    ).status,
    409,
  );
  await save(structuredClone(session));
  assert.equal((await member.client.request("/notifications")).body.unread, 1);
  const task = structuredClone(session);
  task.days[0].blocks[0].description = mention(
    member.user.id,
    "Collaborator",
    false,
  );
  await save(task);
  assert.equal((await member.client.request("/notifications")).body.unread, 1);
  const completed = structuredClone(session);
  completed.days[0].blocks[0].description = mention(
    member.user.id,
    "Collaborator",
    true,
  );
  await save(completed);
  inbox = await member.client.request("/notifications");
  assert.equal(inbox.body.unread, 2);
  assert.ok(
    inbox.body.notifications.some(
      (item: any) => item.kind === "task-completed",
    ),
  );
  const foreign = structuredClone(session);
  foreign.days[0].blocks[1].description = mention(outsider.user.id);
  await save(foreign);
  assert.equal(
    (await outsider.client.request("/notifications")).body.unread,
    0,
  );
});

test("notification preference hides mentions without deleting stored notifications or ordinary comments", async (t) => {
  const h = await harness(t),
    owner = await h.setup(),
    session = await h.session(),
    member = await h.account("member@example.test");
  await h.owner.request(`/sessions/${session.id}/members`, "POST", {
    email: member.user.email,
    role: "viewer",
  });
  await member.client.request(`/sessions/${session.id}/comments`, "POST", {
    text: "@Owner",
    mentions: [owner.id],
  });
  await member.client.request(`/sessions/${session.id}/comments`, "POST", {
    text: "Ordinary comment",
  });
  const account = (await h.owner.request("/account")).body;
  const response = await h.owner.request("/account", "PUT", {
    name: owner.name,
    email: owner.email,
    locale: owner.locale,
    preferences: { ...account.profile.preferences, inAppMentions: false },
  });
  assert.equal(response.status, 200);
  let inbox = await h.owner.request("/notifications");
  assert.equal(inbox.body.unread, 1);
  assert.equal(inbox.body.notifications[0].kind, "comment");
  await h.owner.request("/account", "PUT", {
    name: owner.name,
    email: owner.email,
    locale: owner.locale,
    preferences: { ...account.profile.preferences, inAppMentions: true },
  });
  inbox = await h.owner.request("/notifications");
  assert.equal(inbox.body.unread, 2);
});

test("legacy comments migrate idempotently without losing content; thread summaries are bounded", async (t) => {
  const h = await harness(t),
    owner = await h.setup(),
    session = await h.session(),
    legacy = randomUUID();
  await h.db.run(
    "INSERT INTO comments(id,session_id,block_id,user_id,text,created_at) VALUES($1,$2,$3,$4,$5,$6)",
    [
      legacy,
      session.id,
      null,
      owner.id,
      "Legacy note",
      new Date().toISOString(),
    ],
  );
  const dependencies = {
    db: h.db,
    authenticated: (_req: any, _res: any, next: any) => next(),
    accessible: async () => ({ session, role: "owner" as const }),
  };
  await installCommentsApi(h.app, dependencies);
  await installCommentsApi(h.app, dependencies);
  const migrated = await h.owner.request(
    `/sessions/${session.id}/comments/${legacy}`,
  );
  assert.equal(migrated.status, 200);
  assert.equal(migrated.body.thread.comments[0].text, "Legacy note");
  for (let index = 0; index < 18; index++)
    assert.equal(
      (
        await h.owner.request(`/sessions/${session.id}/comments`, "POST", {
          text: `Reply ${index}`,
          parentId: legacy,
        })
      ).status,
      201,
    );
  const summary = (await h.owner.request(`/sessions/${session.id}/comments`))
    .body.threads[0];
  assert.equal(summary.comments.length, 16);
  assert.equal(summary.totalComments, 19);
  assert.equal(summary.hasMore, true);
  assert.equal(summary.comments[0].id, legacy);
  const detail = (
    await h.owner.request(`/sessions/${session.id}/comments/${legacy}`)
  ).body.thread;
  assert.equal(detail.comments.length, 19);
  assert.equal(detail.hasMore, false);
});

test("mention documents keep only safe stable attributes and plain exports retain readable names", () => {
  const value = mention("user-123", "<script>name</script>");
  assert.deepEqual(richTextMentions(value), ["user-123"]);
  assert.equal(richTextToPlain(value), "@<script>name</script>");
  assert.throws(() =>
    serializeRichText({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              attrs: { id: "javascript:bad", label: "Someone" },
            },
          ],
        },
      ],
    }),
  );
  const document = parseRichText(value);
  assert.deepEqual(document?.content?.[0].content?.[0].attrs, {
    id: "user-123",
    label: "<script>name</script>",
  });
  const html = renderToStaticMarkup(createElement(RichText, { value }));
  assert.ok(html.includes("@&lt;script&gt;name&lt;/script&gt;"));
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("user-123"), false);
});
