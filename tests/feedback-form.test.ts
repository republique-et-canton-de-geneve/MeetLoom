import test from "node:test";
import assert from "node:assert/strict";
import { formSchema, newFeedbackForm } from "../shared/content.js";

test("the ready-made session feedback form is a ROTI from 1 to 5 plus a free comment", () => {
  for (const locale of ["fr", "en"] as const) {
    const form = formSchema.parse(newFeedbackForm(locale));
    assert.equal(form.questions.length, 2);
    const [roti, comment] = form.questions;
    assert.equal(roti.type, "scale");
    assert.ok(roti.type === "scale" && roti.min === 1 && roti.max === 5);
    assert.equal(roti.required, true);
    assert.equal(comment.type, "long");
    assert.equal(comment.required, false);
  }
  assert.match(newFeedbackForm("fr").questions[0].title, /ROTI/);
  // Fresh identifiers every time, so several can coexist.
  assert.notEqual(newFeedbackForm("fr").id, newFeedbackForm("fr").id);
});
