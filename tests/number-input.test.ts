import { test } from "node:test";
import assert from "node:assert/strict";
import { parseNumberInput } from "../src/number-input.js";

test("a number field reads what is typed within its bounds", () => {
  const minutes = { min: 0.1, max: 1440 };
  for (const [text, value] of [
    ["2", 2],
    ["0.5", 0.5],
    [" 12 ", 12],
    ["1440", 1440],
  ] as const)
    assert.equal(parseNumberInput(text, minutes), value, text);
  for (const text of ["0", "1441", "-1", "abc", "Infinity"])
    assert.equal(parseNumberInput(text, minutes), null, text);
});

test("an empty field is not a value, so it can be cleared before typing a new one", () => {
  // Number("") is 0: reading it as a value snapped the field back to its
  // previous number, and replacing 1 by 2 meant typing 12, then deleting 1.
  for (const bounds of [
    { min: 0.1, max: 1440 },
    { min: 0, max: 1440 },
    { min: 1, max: 60, integer: true },
  ])
    for (const text of ["", " "])
      assert.equal(parseNumberInput(text, bounds), null, JSON.stringify(text));
});

test("an integer field ignores a decimal until it is whole", () => {
  const kept = { min: 1, max: 60, integer: true };
  assert.equal(parseNumberInput("30", kept), 30);
  assert.equal(parseNumberInput("2.5", kept), null);
});
