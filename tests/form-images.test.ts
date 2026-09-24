import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { harness, origin, password } from "./support.js";
import {
  newForm,
  newQuestion,
  validateFormAnswers,
  formSchema,
  type FormResponse,
} from "../shared/content.js";
import {
  FORM_IMAGE_MAX_BYTES,
  parseFormImage,
  isStoredFormImage,
} from "../shared/form-images.js";
import { formResponseContext } from "../shared/form-analysis.js";
import { exportResponsesCsv } from "../src/form-export.js";
import { createSession, publicProjection } from "../shared/domain.js";
import { sessionInputSchema } from "../shared/validation.js";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/ZFoAAAAASUVORK5CYII=";
const jpeg = (size: number) =>
  "data:image/jpeg;base64," +
  Buffer.concat([
    Buffer.from([255, 216, 255]),
    Buffer.alloc(size - 5),
    Buffer.from([255, 217]),
  ]).toString("base64");

test("native block fields are available in both languages and internal defaults stay private", () => {
  for (const locale of ["fr", "en"] as const) {
    const session = createSession("owner", "Session", locale);
    assert.equal(sessionInputSchema.safeParse(session).success, true);
    assert.equal(session.columns.length, 8);
    for (const id of [
      "additional",
      "objectives",
      "materials",
      "instructions",
      "context",
    ]) {
      const column = session.columns.find((column) => column.id === id)!;
      assert.ok(column.label);
      assert.equal(column.visibility, "team");
      assert.equal(column.visible, false);
      assert.equal(
        publicProjection(session).columns.some((column) => column.id === id),
        false,
      );
    }
    assert.equal(
      session.columns.find((column) => column.id === "materials")?.kind,
      "materials",
    );
    assert.equal(
      session.columns.find((column) => column.id === "objectives")?.label,
      locale === "fr" ? "Objectifs" : "Objectives",
    );
  }
});

test("image questions accept bounded raster data and enforce required and aggregate limits", () => {
  const form = newForm("en"),
    question = { ...newQuestion("image", "en"), required: true };
  form.questions = [question];
  assert.equal(formSchema.safeParse(form).success, true);
  assert.equal(parseFormImage(png)?.mime, "image/png");
  assert.deepEqual(
    validateFormAnswers(form, { [question.id]: png }).errors,
    {},
  );
  assert.equal(validateFormAnswers(form, {}).errors[question.id], "REQUIRED");
  for (const value of [
    "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    "https://example.test/a.png",
    png.replace("image/png", "image/jpeg"),
    "image:" + "a".repeat(64),
    jpeg(FORM_IMAGE_MAX_BYTES + 1),
  ]) {
    assert.equal(parseFormImage(value), null);
    assert.equal(
      validateFormAnswers(form, { [question.id]: value }).errors[question.id],
      "INVALID_IMAGE",
    );
  }
  const second = newQuestion("image", "en"),
    third = newQuestion("image", "en");
  form.questions.push(second, third);
  const limit = jpeg(FORM_IMAGE_MAX_BYTES);
  assert.equal(parseFormImage(limit)?.size, FORM_IMAGE_MAX_BYTES);
  assert.equal(
    validateFormAnswers(form, {
      [question.id]: limit,
      [second.id]: limit,
      [third.id]: png,
    }).errors[third.id],
    "INVALID_IMAGE",
  );
  assert.equal(isStoredFormImage("image:" + "a".repeat(64)), true);
});

test("image responses stay private, use idempotent references and never enter AI text or CSV", async (t) => {
  const h = await harness(t),
    owner = await h.setup(),
    session = await h.session();
  const form = newForm("en"),
    question = { ...newQuestion("image", "en"), required: true };
  form.identityMode = "anonymous";
  form.questions = [question];
  session.forms = [form];
  const saved = await h.owner.request(`/sessions/${session.id}`, "PUT", {
    session,
    version: session.version,
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const prefix = `/sessions/${session.id}/forms/${form.id}`;
  const publication = await h.owner.request(prefix + "/publish", "POST", {
    version: saved.body.session.version,
  });
  assert.equal(publication.status, 200, JSON.stringify(publication.body));
  const path = `/forms/${publication.body.publication.token}/responses`,
    body = {
      revision: 1,
      submissionId: randomUUID(),
      answers: { [question.id]: png },
    };
  const created = await h.owner.request(path, "POST", body);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.response.id;
  assert.equal(
    (await h.client().request(path, "POST", body)).body.response.id,
    id,
  );
  assert.equal(
    (
      await h.client().request(path, "POST", {
        ...body,
        answers: { [question.id]: jpeg(20) },
      })
    ).status,
    409,
  );
  const responses = await h.owner.request(prefix + "/responses"),
    response = responses.body.responses[0] as FormResponse;
  assert.equal(response.respondent, null);
  assert.ok(isStoredFormImage(response.answers[question.id]));
  assert.equal(
    JSON.stringify(responses.body).includes(png.split(",")[1]),
    false,
  );
  assert.equal(
    (await h.db.all("SELECT question_id FROM form_response_images")).length,
    1,
  );
  const context = JSON.stringify(formResponseContext(response)),
    csv = exportResponsesCsv([response], "en");
  for (const text of [context, csv]) {
    assert.equal(text.includes(png.split(",")[1]), false);
    assert.equal(text.includes(response.answers[question.id] as string), false);
    assert.ok(text.includes("Image"));
  }
  const imagePath = prefix + `/responses/${id}/images/${question.id}`;
  assert.equal((await h.client().request(imagePath)).status, 401);
  const viewer = await h.account("viewer@example.test");
  await h.owner.request(`/sessions/${session.id}/members`, "POST", {
    email: viewer.user.email,
    role: "viewer",
  });
  assert.equal((await viewer.client.request(imagePath)).status, 403);
  const outsider = await h.account("outsider@example.test");
  assert.equal((await outsider.client.request(imagePath)).status, 404);
  const login = await fetch(h.base + "/api/auth/login", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ email: owner.email, password }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const image = await fetch(h.base + "/api" + imagePath, {
    headers: { Cookie: cookie },
  });
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type")!, /^image\/png/);
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.match(image.headers.get("cache-control")!, /no-store/);
  assert.match(image.headers.get("content-security-policy")!, /sandbox/);
  assert.deepEqual(
    Buffer.from(await image.arrayBuffer()),
    Buffer.from(png.split(",")[1], "base64"),
  );
  assert.equal(
    (await h.owner.request(imagePath.replace(form.id, "missing-form"))).status,
    404,
  );
  assert.equal(
    (await h.owner.request(prefix + `/responses/${id}`, "DELETE")).status,
    204,
  );
  assert.equal(
    (await h.db.all("SELECT question_id FROM form_response_images")).length,
    0,
  );
  assert.equal((await h.owner.request(imagePath)).status, 404);
});
