import test from "node:test";
import assert from "node:assert/strict";
import { plannedStartUnavailableReason } from "../src/Timer.tsx";

// 24 September 2026, 08:53 in Zurich (UTC+2).
const now = Date.UTC(2026, 8, 24, 6, 53);
const nineToday = Date.UTC(2026, 8, 24, 7, 0);

test("starting from the scheduled time is explained while that time is still ahead", () => {
  assert.equal(
    plannedStartUnavailableReason(nineToday, now, "Europe/Zurich", "fr"),
    "disponible dès 09:00",
  );
  assert.equal(
    plannedStartUnavailableReason(nineToday, now, "Europe/Zurich", "en"),
    "available from 09:00",
  );
});

test("a scheduled start on a later day names the date", () => {
  const tomorrow = nineToday + 24 * 3_600_000;
  assert.match(
    plannedStartUnavailableReason(tomorrow, now, "Europe/Zurich", "fr")!,
    /^disponible dès 25 sept\.?,? 09:00$/,
  );
});

test("the option is available once the scheduled time has passed", () => {
  assert.equal(
    plannedStartUnavailableReason(nineToday, nineToday, "Europe/Zurich", "fr"),
    null,
  );
  assert.equal(
    plannedStartUnavailableReason(now - 60_000, now, "Europe/Zurich", "en"),
    null,
  );
});

test("an unusable schedule or a very old one gets its own reason", () => {
  assert.equal(
    plannedStartUnavailableReason(null, now, "Europe/Zurich", "en"),
    "check the start date and time",
  );
  assert.equal(
    plannedStartUnavailableReason(now - 100_000_000_001, now, "UTC", "fr"),
    "heure prévue trop ancienne",
  );
});
