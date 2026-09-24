import test from "node:test";
import assert from "node:assert/strict";
import { createSession, publicProjection } from "../shared/domain.js";
import {
  cloneContent,
  contentIds,
  newForm,
  newPage,
  newQuestion,
  orderedContent,
  validateFormAnswers,
} from "../shared/content.js";
import { sessionInputSchema } from "../shared/validation.js";
import { exportResponsesCsv } from "../src/form-export.js";

test("pages remain private by default and public projection removes forms, internal sections and unknown properties", () => {
  const session = createSession("owner", "Content", "fr");
  const privatePage = newPage("fr"),
    publicPage = newPage("fr"),
    form = newForm("fr");
  privatePage.sections[0].content = "SECRET_PAGE";
  form.title = "SECRET_FORM";
  publicPage.visibility = "public";
  publicPage.sections[0].content = "Public content";
  Object.assign(publicPage.sections[0], { secret: "SECRET_UNKNOWN" });
  session.pages = [privatePage, publicPage];
  session.forms = [form];
  session.contentOrder = [
    { kind: "form", id: form.id },
    { kind: "page", id: privatePage.id },
    { kind: "page", id: publicPage.id },
    { kind: "day", id: session.days[0].id },
  ];
  const projected = publicProjection(session);
  assert.equal(JSON.stringify(projected).includes("SECRET"), false);
  assert.equal(projected.pages?.length, 1);
  assert.equal(projected.pages?.[0].sections[0].content, "Public content");
  assert.deepEqual(
    projected.contentOrder?.map((item) => item.kind),
    ["page", "day"],
  );
});
test("content IDs must be globally unique and cloning remaps nested IDs and navigation", () => {
  const session = createSession("owner", "Content", "en");
  const page = newPage("en"),
    form = newForm("en");
  form.questions = [newQuestion("matrix", "en")];
  session.pages = [page];
  session.forms = [form];
  session.contentOrder = [
    { kind: "page", id: page.id },
    { kind: "form", id: form.id },
  ];
  assert.equal(sessionInputSchema.safeParse(session).success, true);
  const cloned = cloneContent(session, undefined, true);
  assert.equal(
    contentIds(cloned).some((id) => contentIds(session).includes(id)),
    false,
  );
  assert.equal(cloned.pages?.[0].visibility, "team");
  assert.equal(cloned.contentOrder?.[0].id, cloned.pages?.[0].id);
  page.sections[0].id = form.questions[0].id;
  assert.equal(sessionInputSchema.safeParse(session).success, false);
});
test("form answers validate required fields, option IDs, bounded scales and complete matrices", () => {
  const form = newForm("fr");
  const short = newQuestion("short", "fr"),
    single = newQuestion("single", "fr"),
    multiple = newQuestion("multiple", "fr"),
    scale = newQuestion("scale", "fr"),
    matrix = newQuestion("matrix", "fr");
  form.questions = [short, single, multiple, scale, matrix].map((question) => ({
    ...question,
    required: true,
  }));
  const empty = validateFormAnswers(form, {});
  assert.equal(Object.keys(empty.errors).length, 5);
  if (
    single.type !== "single" ||
    multiple.type !== "multiple" ||
    matrix.type !== "matrix"
  )
    throw Error("fixture");
  const answers = {
    [short.id]: "Hello",
    [single.id]: single.options[0].id,
    [multiple.id]: multiple.options.map((option) => option.id),
    [scale.id]: 3,
    [matrix.id]: { [matrix.rows[0].id]: matrix.options[0].id },
  };
  assert.deepEqual(validateFormAnswers(form, answers).errors, {});
  assert.equal(
    validateFormAnswers(form, { ...answers, [scale.id]: 11 }).errors[scale.id],
    "INVALID_SCALE",
  );
  assert.equal(
    validateFormAnswers(form, { ...answers, [single.id]: "invented" }).errors[
      single.id
    ],
    "INVALID_CHOICE",
  );
  assert.equal(
    validateFormAnswers(form, {
      ...answers,
      [multiple.id]: [multiple.options[0].id, multiple.options[0].id],
    }).errors[multiple.id],
    "INVALID_CHOICE",
  );
  assert.equal(
    validateFormAnswers(form, { ...answers, [matrix.id]: { bad: "row" } })
      .errors[matrix.id],
    "INVALID_MATRIX",
  );
  assert.equal(
    validateFormAnswers(form, { ...answers, constructor: "x" }).errors._form,
    "UNKNOWN_QUESTION",
  );
});
test("response CSV uses submission snapshots and neutralizes formulas without exposing absent identity", () => {
  const form = newForm("en");
  const question = newQuestion("single", "en");
  if (question.type !== "single") throw Error();
  question.options[0].label = '=WEBSERVICE("untrusted")';
  form.questions = [question];
  const csv = exportResponsesCsv(
    [
      {
        id: "r",
        formId: form.id,
        revision: 1,
        definition: form,
        answers: { [question.id]: question.options[0].id },
        respondent: null,
        createdAt: "2026-09-23T10:00:00.000Z",
      },
    ],
    "en",
  );
  assert.match(csv, /Anonymous/);
  assert.match(csv, /"'=WEBSERVICE/);
  assert.equal(csv.includes(question.options[0].id), false);
});
test("navigation preserves known ordered content and appends new days", () => {
  const session = createSession("owner", "Nav", "fr");
  const page = newPage("fr");
  session.pages = [page];
  session.contentOrder = [{ kind: "page", id: page.id }];
  assert.deepEqual(
    orderedContent(session).map((item) => item.kind),
    ["page", "day"],
  );
});
