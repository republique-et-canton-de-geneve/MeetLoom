import { test } from "node:test";
import assert from "node:assert/strict";
import { displayTime } from "../shared/display-time.js";
test("personal display converts winter/summer and different DST change dates without changing source", () => {
  const prefs = { displayTimezone: "America/New_York", hour12: false };
  assert.equal(displayTime(540, "2026-01-12", "Europe/Zurich", prefs), "03:00");
  assert.equal(displayTime(540, "2026-07-12", "Europe/Zurich", prefs), "03:00");
  assert.equal(displayTime(540, "2026-03-16", "Europe/Zurich", prefs), "04:00");
  assert.match(
    displayTime(60, "2026-01-12", "Europe/Zurich", prefs),
    /19:00.*2026-01-11/,
  );
  assert.equal(
    displayTime(540, "2026-07-12", "Europe/Zurich", {
      displayTimezone: "",
      hour12: false,
    }),
    "09:00",
  );
  assert.match(
    displayTime(
      540,
      "2026-07-12",
      "Europe/Zurich",
      { ...prefs, hour12: true },
      "en",
    ),
    /03:00 am/i,
  );
  assert.match(
    displayTime(1980, "2026-03-28", "Europe/Zurich", prefs),
    /03:00.*2026-03-29/,
  );
});
