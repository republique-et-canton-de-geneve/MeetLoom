import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { harness, listen, stop } from "./support.js";
import { newForm, newQuestion } from "../shared/content.js";
import { applyAiOperations } from "../shared/ai.js";
import { createSession } from "../shared/domain.js";
test("AI can revise Pages and form drafts without changing visibility, publication identity or prior questions", () => {
  const session = createSession("owner", "Draft", "fr");
  const form = newForm("fr");
  form.questions = [newQuestion("short", "fr")];
  session.forms = [form];
  const before = JSON.stringify(session);
  const revised = applyAiOperations(
    session,
    [
      {
        type: "update_form",
        formId: form.id,
        title: "Feedback",
        questions: [
          {
            type: "scale",
            title: "Satisfaction",
            description: "",
            required: true,
            min: 1,
            max: 5,
          },
        ],
      },
    ],
    "fr",
  );
  assert.equal(revised.forms?.[0].id, form.id);
  assert.equal(revised.forms?.[0].identityMode, form.identityMode);
  assert.equal(revised.forms?.[0].questions[0].type, "scale");
  assert.notEqual(revised.forms?.[0].questions[0].id, form.questions[0].id);
  assert.equal(JSON.stringify(session), before);
  assert.throws(
    () =>
      applyAiOperations(
        session,
        [{ type: "update_form", formId: "missing", title: "bad" }],
        "fr",
      ),
    /AI_TARGET_MISSING/,
  );
});
test("response AI summary is editor-only, excludes identities and public forms stop on session closure", async (t) => {
  let received = "";
  const provider = createServer(async (req, res) => {
    for await (const part of req) received += part;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Les répondants souhaitent davantage de pratique.",
            },
          },
        ],
      }),
    );
  });
  const baseUrl = await listen(provider);
  t.after(() => stop(provider));
  const h = await harness(t, { ai: { baseUrl } });
  await h.setup();
  let session = await h.session();
  const form = newForm("fr");
  form.identityMode = "automatic";
  form.questions = [
    { ...newQuestion("long", "fr"), title: "Que souhaitez-vous améliorer ?" },
  ];
  session.forms = [form];
  session = (
    await h.owner.request(`/sessions/${session.id}`, "PUT", {
      session,
      version: session.version,
    })
  ).body.session;
  const base = `/sessions/${session.id}/forms/${form.id}`;
  const publication = await h.owner.request(`${base}/publish`, "POST", {
    version: session.version,
  });
  assert.equal(publication.status, 200);
  const token = publication.body.publication.token;
  const submission = await h.owner.request(
    `/forms/${token}/responses`,
    "POST",
    {
      revision: 1,
      submissionId: randomUUID(),
      shareIdentity: true,
      answers: { [form.questions[0].id]: "Davantage de pratique." },
    },
  );
  assert.equal(submission.status, 201);
  const summary = await h.owner.request(`${base}/summary`, "POST", {
    locale: "fr",
  });
  assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.included, 1);
  assert.equal(summary.body.partial, false);
  assert.match(received, /Davantage de pratique/);
  assert.ok(!received.includes("owner@example.test"));
  assert.ok(!received.includes("respondent_id"));
  assert.ok(!received.includes(submission.body.response.id));
  const viewer = await h.account("viewer-form@example.test");
  await h.owner.request(`/sessions/${session.id}/members`, "POST", {
    email: viewer.user.email,
    role: "viewer",
  });
  assert.equal(
    (await viewer.client.request(`${base}/summary`, "POST", { locale: "fr" }))
      .status,
    403,
  );
  const current = (await h.owner.request(`/sessions/${session.id}`)).body
    .session;
  const closed = await h.owner.request(
    `/sessions/${session.id}/lifecycle`,
    "POST",
    { version: current.version, action: "close" },
  );
  assert.equal(closed.status, 200, JSON.stringify(closed.body));
  assert.equal(
    (await h.client().request(`/forms/${token}`)).body.code,
    "SESSION_CLOSED",
  );
  assert.equal(
    (
      await h.client().request(`/forms/${token}/responses`, "POST", {
        revision: 1,
        submissionId: randomUUID(),
        answers: { [form.questions[0].id]: "Late answer" },
      })
    ).body.code,
    "SESSION_CLOSED",
  );
});
