import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { harness } from "./support.js";
import {
  newForm,
  newPage,
  newQuestion,
  type SessionForm,
} from "../shared/content.js";
import type { Session } from "../shared/model.js";

async function fixture(
  t: Parameters<typeof harness>[0],
  mode: SessionForm["identityMode"] = "anonymous",
) {
  const h = await harness(t);
  const owner = await h.setup();
  let session = await h.session();
  const form = newForm("en");
  form.identityMode = mode;
  form.questions = [{ ...newQuestion("short", "en"), required: true }];
  const privatePage = newPage("en");
  privatePage.sections[0].content = "SECRET_PAGE";
  session.pages = [privatePage];
  session.forms = [form];
  const saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  session = saved.body.session;
  const prefix = `/sessions/${session.id}/forms/${form.id}`;
  const publication = await h.owner.request(`${prefix}/publish`, "POST", {
    version: session.version,
  });
  assert.equal(publication.status, 200, JSON.stringify(publication.body));
  return {
    ...h,
    ownerUser: owner,
    session,
    form,
    prefix,
    publication: publication.body.publication,
    token: publication.body.publication.token as string,
  };
}

test("published form snapshots exclude agenda details and truly anonymous responses omit account identity", async (t) => {
  const h = await fixture(t);
  const publicForm = await h.owner.request(`/forms/${h.token}`);
  assert.equal(publicForm.status, 200);
  assert.equal(publicForm.body.identity, null);
  assert.equal(JSON.stringify(publicForm.body).includes("SECRET_PAGE"), false);
  const submitted = await h.owner.request(
    `/forms/${h.token}/responses`,
    "POST",
    {
      revision: 1,
      submissionId: randomUUID(),
      answers: { [h.form.questions[0].id]: "Answer" },
      shareIdentity: true,
    },
  );
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const stored = await h.db.all<{
    respondent_id: string | null;
    respondent_name: string | null;
    respondent_email: string | null;
  }>(
    "SELECT respondent_id,respondent_name,respondent_email FROM form_responses",
  );
  assert.deepEqual(
    stored.map((row) => ({ ...row })),
    [{ respondent_id: null, respondent_name: null, respondent_email: null }],
  );
  const responses = await h.owner.request(`${h.prefix}/responses`);
  assert.equal(responses.body.total, 1);
  assert.equal(responses.body.responses[0].respondent, null);
  assert.equal((await h.client().request(`${h.prefix}/responses`)).status, 401);
  const viewer = await h.account("viewer@example.test");
  await h.owner.request(`/sessions/${h.session.id}/members`, "POST", {
    email: viewer.user.email,
    role: "viewer",
  });
  assert.equal(
    (await viewer.client.request(`${h.prefix}/responses`)).status,
    403,
  );
  assert.equal(
    (
      await viewer.client.request(`${h.prefix}/publish`, "POST", {
        version: h.session.version,
      })
    ).status,
    403,
  );
});

test("visitor links expose only explicitly selected published forms and revoke nested access", async (t) => {
  const h = await fixture(t),
    guest = h.client();
  const shared = await h.owner.request(
    `/sessions/${h.session.id}/shares`,
    "POST",
    {
      label: "Forms",
      dayIds: [],
      pageIds: [],
      formIds: [h.form.id],
      initialContentId: h.form.id,
    },
  );
  assert.equal(shared.status, 201, JSON.stringify(shared.body));
  const link = shared.body.share;
  const agenda = await guest.request(`/public/${link.token}`);
  assert.equal(
    agenda.body.sharing.navigation.some(
      (item: { id: string }) => item.id === h.form.id,
    ),
    true,
  );
  assert.equal(JSON.stringify(agenda.body).includes("SECRET_PAGE"), false);
  assert.equal(agenda.body.session.forms, undefined);
  const path = `/public/${link.token}/forms/${h.form.id}`;
  assert.equal((await guest.request(path)).status, 200);
  assert.equal(
    (await guest.request(`/public/${link.token}/forms/unknown`)).status,
    404,
  );
  const answer = await guest.request(`${path}/responses`, "POST", {
    revision: 1,
    submissionId: randomUUID(),
    answers: { [h.form.questions[0].id]: "Feedback" },
  });
  assert.equal(answer.status, 201, JSON.stringify(answer.body));
  const privateLink = (
    await h.owner.request(`/sessions/${h.session.id}/shares`, "POST", {
      label: "No form",
    })
  ).body.share;
  assert.equal(
    (await guest.request(`/public/${privateLink.token}/forms/${h.form.id}`))
      .status,
    404,
  );
  await h.owner.request(
    `/sessions/${h.session.id}/shares/${link.id}`,
    "PATCH",
    { enabled: false },
  );
  assert.equal((await guest.request(path)).status, 404);
  assert.equal(
    (
      await guest.request(`${path}/responses`, "POST", {
        revision: 1,
        submissionId: randomUUID(),
        answers: { [h.form.questions[0].id]: "No longer permitted" },
      })
    ).status,
    404,
  );
  assert.equal((await guest.request(`/forms/${h.token}`)).status, 200);
});
test("publication revisions, token rotation, idempotency and required questions are enforced", async (t) => {
  const h = await fixture(t);
  const anon = h.client();
  const body = {
    revision: 1,
    submissionId: randomUUID(),
    answers: { [h.form.questions[0].id]: "First" },
  };
  assert.equal(
    (
      await anon.request(`/forms/${h.token}/responses`, "POST", {
        ...body,
        answers: {},
      })
    ).status,
    400,
  );
  const first = await anon.request(`/forms/${h.token}/responses`, "POST", body),
    retry = await anon.request(`/forms/${h.token}/responses`, "POST", body);
  assert.equal(first.status, 201);
  assert.equal(retry.body.response.id, first.body.response.id);
  assert.equal(
    (
      await anon.request(`/forms/${h.token}/responses`, "POST", {
        ...body,
        answers: { [h.form.questions[0].id]: "Changed" },
      })
    ).status,
    409,
  );
  const draft = structuredClone(h.session);
  draft.forms![0].questions[0].title = "Changed draft";
  const saved = await h.owner.request(`/sessions/${draft.id}`, "PUT", {
    session: draft,
    version: draft.version,
  });
  assert.equal(saved.status, 200);
  assert.notEqual(
    (await anon.request(`/forms/${h.token}`)).body.form.questions[0].title,
    "Changed draft",
  );
  assert.equal(
    (
      await h.owner.request(`${h.prefix}/publish`, "POST", {
        version: draft.version,
      })
    ).status,
    409,
  );
  const published = await h.owner.request(`${h.prefix}/publish`, "POST", {
    version: saved.body.session.version,
  });
  assert.equal(published.body.publication.revision, 2);
  assert.equal(
    (
      await anon.request(`/forms/${h.token}/responses`, "POST", {
        ...body,
        submissionId: randomUUID(),
      })
    ).status,
    409,
  );
  const rotated = await h.owner.request(`${h.prefix}/rotate`, "POST", {
    version: saved.body.session.version,
  });
  assert.equal((await anon.request(`/forms/${h.token}`)).status, 404);
  const newToken = rotated.body.publication.token;
  assert.equal((await anon.request(`/forms/${newToken}`)).status, 200);
  await h.owner.request(`${h.prefix}/unpublish`, "POST", {
    version: saved.body.session.version,
  });
  assert.equal((await anon.request(`/forms/${newToken}`)).status, 404);
  assert.equal(
    (
      await anon.request(`/forms/${newToken}/responses`, "POST", {
        ...body,
        revision: 3,
        submissionId: randomUUID(),
      })
    ).status,
    404,
  );
  const results = await h.owner.request(`${h.prefix}/responses`);
  assert.equal(results.body.total, 1);
  assert.notEqual(
    results.body.responses[0].definition.questions[0].title,
    "Changed draft",
  );
});
test("automatic and optional identities only come from authenticated accounts", async (t) => {
  const h = await fixture(t, "optional");
  const submit = async (shareIdentity: boolean) =>
    h.owner.request(`/forms/${h.token}/responses`, "POST", {
      revision: 1,
      submissionId: randomUUID(),
      shareIdentity,
      answers: { [h.form.questions[0].id]: "Reply" },
    });
  assert.equal((await submit(false)).status, 201);
  assert.equal((await submit(true)).status, 201);
  const rows = (await h.owner.request(`${h.prefix}/responses`)).body.responses;
  assert.equal(
    rows.filter((row: { respondent: unknown }) => row.respondent === null)
      .length,
    1,
  );
  assert.equal(
    rows.find((row: { respondent: unknown }) => row.respondent !== null)
      .respondent.id,
    h.ownerUser.id,
  );
  assert.equal(
    (
      await h.client().request(`/forms/${h.token}/responses`, "POST", {
        revision: 1,
        submissionId: randomUUID(),
        shareIdentity: true,
        respondent: { id: h.ownerUser.id },
        answers: { [h.form.questions[0].id]: "Forged" },
      })
    ).status,
    400,
  );
});
test("deleting and restoring a form cannot reactivate its publication; duplication remaps content IDs", async (t) => {
  const h = await fixture(t);
  const duplicate = await h.owner.request(
    `/sessions/${h.session.id}/duplicate`,
    "POST",
  );
  assert.equal(duplicate.status, 201);
  assert.notEqual(duplicate.body.session.forms[0].id, h.form.id);
  assert.notEqual(
    duplicate.body.session.forms[0].questions[0].id,
    h.form.questions[0].id,
  );
  assert.equal(
    (
      await h.owner.request(
        `/sessions/${duplicate.body.session.id}/forms/${duplicate.body.session.forms[0].id}/publication`,
      )
    ).body.publication,
    null,
  );
  const removed = { ...h.session, forms: [] };
  const saved = await h.owner.request(`/sessions/${h.session.id}`, "PUT", {
    session: removed,
    version: h.session.version,
  });
  assert.equal(saved.status, 200);
  assert.equal((await h.client().request(`/forms/${h.token}`)).status, 404);
  const restored = { ...saved.body.session, forms: h.session.forms } as Session;
  const back = await h.owner.request(`/sessions/${h.session.id}`, "PUT", {
    session: restored,
    version: restored.version,
  });
  assert.equal(back.status, 200);
  assert.equal((await h.client().request(`/forms/${h.token}`)).status, 404);
});
