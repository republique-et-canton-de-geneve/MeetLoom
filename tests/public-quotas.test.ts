import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { harness } from "./support.js";
import { newForm, newQuestion } from "../shared/content.js";

// Anonymous holders of a form or visitor link must not be able to grow the
// database shared by every session without bound (security review finding).

async function publishedForm(
  t: Parameters<typeof harness>[0],
  quotas: Parameters<typeof harness>[1],
) {
  const h = await harness(t, quotas);
  await h.setup();
  let session = await h.session();
  const form = newForm("en");
  form.identityMode = "anonymous";
  form.questions = [{ ...newQuestion("long", "en"), required: true }];
  session.forms = [form];
  const saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  session = saved.body.session;
  const prefix = `/sessions/${session.id}/forms/${form.id}`;
  const published = await h.owner.request(`${prefix}/publish`, "POST", {
    version: session.version,
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
  const guest = h.client();
  const submit = (text: string, submissionId: string = randomUUID()) =>
    guest.request(
      `/forms/${published.body.publication.token}/responses`,
      "POST",
      {
        revision: 1,
        submissionId,
        answers: { [form.questions[0].id]: text },
      },
    );
  return { ...h, prefix, submit };
}

test("a published form stops accepting responses at its count quota, and deleting responses frees room", async (t) => {
  const h = await publishedForm(t, {
    quotas: { formResponses: 2, formBytes: 1_000_000 },
  });
  const firstSubmission = randomUUID();
  const first = await h.submit("One", firstSubmission);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal((await h.submit("Two")).status, 201);
  const refused = await h.submit("Three");
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "FORM_FULL");
  const retried = await h.submit("One", firstSubmission);
  assert.equal(
    retried.status,
    201,
    "an idempotent retry is not a new response",
  );
  const stored = await h.db.all("SELECT id FROM form_responses");
  assert.equal(stored.length, 2);
  const removed = await h.owner.request(
    `${h.prefix}/responses/${first.body.response.id}`,
    "DELETE",
  );
  assert.equal(removed.status, 204);
  assert.equal((await h.submit("Three")).status, 201);
});

test("a published form stops accepting responses at its storage quota", async (t) => {
  const h = await publishedForm(t, {
    quotas: { formResponses: 100, formBytes: 3_000 },
  });
  assert.equal((await h.submit("x".repeat(1_000))).status, 201);
  assert.equal((await h.submit("x".repeat(1_000))).status, 201);
  const refused = await h.submit("x".repeat(1_000));
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "FORM_FULL");
  assert.equal((await h.submit("small")).status, 201);
});

test("visitor comments stop at the per-link quota while team replies still work", async (t) => {
  const h = await harness(t, { quotas: { visitorComments: 2 } });
  await h.setup();
  const session = await h.session(),
    path = `/sessions/${session.id}`;
  const share = (
    await h.owner.request(path + "/shares", "POST", {
      label: "Visitor",
      allowComments: true,
    })
  ).body.share;
  const guest = h.client(),
    url = `/public/${share.token}/comments`;
  const post = (text: string) =>
    guest.request(url, "POST", { author: "Camille", text });
  const first = await post("One");
  assert.equal(first.status, 201);
  assert.equal((await post("Two")).status, 201);
  const refused = await post("Three");
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, "VISITOR_COMMENT_LIMIT");
  assert.equal(
    (
      await h.owner.request(
        path + `/visitor-comments/${first.body.comment.id}/replies`,
        "POST",
        { text: "The team answers" },
      )
    ).status,
    201,
  );
});
