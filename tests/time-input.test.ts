import { test } from "node:test";
import assert from "node:assert/strict";
import { parseClock, parseDuration, shiftClock } from "../src/time-input.js";

test("duration accepts practical French and English notation without losing zero milestones", () => {
  for (const [text, minutes] of [
    ["0", 0],
    ["90", 90],
    ["1h30", 90],
    ["1:30", 90],
    ["1.5h", 90],
    ["1,5", 1.5],
    ["90s", 1.5],
    ["15 min", 15],
    ["24h", 1440],
  ] as const)
    assert.equal(parseDuration(text), minutes, text);
  for (const text of ["", "-1", "1:99", "1450", "Infinity", "12foo"])
    assert.equal(parseDuration(text), null, text);
});
test("clock accepts concise input but rejects invalid or ambiguous values", () => {
  for (const [text, time] of [
    ["9", "09:00"],
    ["930", "09:30"],
    ["9h30", "09:30"],
    ["09:3", "09:03"],
    ["2359", "23:59"],
    ["0", "00:00"],
  ] as const)
    assert.equal(parseClock(text), time, text);
  for (const text of ["", "24:00", "9:99", "hello", "-1", "2400"])
    assert.equal(parseClock(text), null, text);
  assert.equal(shiftClock("23:59", 1), "00:00");
  assert.equal(shiftClock("00:00", -5), "23:55");
});
