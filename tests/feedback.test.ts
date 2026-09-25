import test from "node:test";
import assert from "node:assert/strict";
import { harness } from "./support.js";

test("anyone signed in reports a problem or an idea; administrators triage it without GitHub", async (t) => {
  const h = await harness(t, {
    feedbackIssuesUrl: "https://github.com/example/meetloom/issues/new",
  });
  await h.setup();
  const member = await h.account("member@example.test");
  assert.equal(
    (
      await h.client().request("/feedback", "POST", {
        kind: "bug",
        message: "Anonymous",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await member.client.request("/feedback", "POST", {
        kind: "bug",
        message: " ",
      })
    ).status,
    400,
  );
  const sent = await member.client.request("/feedback", "POST", {
    kind: "bug",
    message: "Le minuteur se fige quand je change d’onglet.",
    page: "/session/abc",
  });
  assert.equal(sent.status, 201, JSON.stringify(sent.body));
  await h.owner.request("/feedback", "POST", {
    kind: "idea",
    message: "Un mode sombre.",
  });

  // People see their own reports and what became of them.
  const mine = (await member.client.request("/feedback/mine")).body.feedback;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, "new");
  assert.equal(mine[0].message.includes("minuteur"), true);

  assert.equal((await member.client.request("/admin/feedback")).status, 403);
  const inbox = (await h.owner.request("/admin/feedback")).body;
  assert.equal(
    inbox.issuesUrl,
    "https://github.com/example/meetloom/issues/new",
  );
  assert.equal(inbox.feedback.length, 2);
  const bug = inbox.feedback.find(
    (item: { kind: string }) => item.kind === "bug",
  );
  assert.equal(bug.author.email, "member@example.test");
  assert.equal(bug.page, "/session/abc");
  assert.match(bug.appVersion, /\d+\.\d+\.\d+/);

  const done = await h.owner.request(`/admin/feedback/${bug.id}`, "PATCH", {
    status: "done",
  });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(
    (await member.client.request("/feedback/mine")).body.feedback[0].status,
    "done",
  );
  assert.equal(
    (
      await h.owner.request(`/admin/feedback/${bug.id}`, "PATCH", {
        status: "whatever",
      })
    ).status,
    400,
  );
});

test("without an issues address, the inbox offers no GitHub link", async (t) => {
  const h = await harness(t, { feedbackIssuesUrl: "" });
  await h.setup();
  assert.equal((await h.owner.request("/admin/feedback")).body.issuesUrl, null);
});
