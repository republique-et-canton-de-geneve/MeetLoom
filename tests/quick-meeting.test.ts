import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quickMeetingPrompt,
  quickMeetingSession,
} from "../shared/quick-meeting.js";
import { newBlock, timerView, totalDuration } from "../shared/domain.js";

const invitation = {
  title: "Decision meeting",
  start: "2026-11-04T13:00:00Z",
  end: "2026-11-04T13:45:00Z",
  body: "Welcome 5 min, discussion 30 min, closing 10 min.",
};
test("a quick meeting uses the browser timezone consistently for its displayed schedule", () => {
  const original = process.env.TZ;
  try {
    for (const timezone of ["UTC", "Asia/Tokyo"]) {
      process.env.TZ = timezone;
      const session = quickMeetingSession(
        invitation,
        "en",
        Date.parse(invitation.start),
      );
      assert.equal(session.timezone, timezone);
      assert.equal(
        session.days[0].startTime,
        timezone === "UTC" ? "13:00" : "22:00",
      );
      assert.equal(session.run.runStartedAt, Date.parse(invitation.start));
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
test("a quick meeting starts at its scheduled instant and catches up without saving", () => {
  const now = Date.parse("2026-11-04T13:10:00Z");
  const session = quickMeetingSession(invitation, "en", now);
  assert.equal(session.title, invitation.title);
  assert.equal(session.days[0].blocks.length, 1);
  assert.equal(totalDuration(session), 45);
  assert.equal(session.run.runStartedAt, Date.parse(invitation.start));
  assert.equal(timerView(session, now).remainingSeconds, 35 * 60);
});
test("future invitations count down to their real start, preserving seconds", () => {
  const event = {
    ...invitation,
    start: "2026-11-04T13:00:25Z",
    end: "2026-11-04T13:45:25Z",
  };
  const now = Date.parse("2026-11-04T12:59:25Z");
  const session = quickMeetingSession(event, "fr", now);
  assert.equal(timerView(session, now).startsInSeconds, 60);
  assert.equal(timerView(session, now).remainingSeconds, 2700);
});
test("applying a proposed agenda preserves the invitation clock and selects the elapsed block", () => {
  const now = Date.parse("2026-11-04T13:10:00Z");
  const blocks = [
    newBlock("en", { title: "Welcome", duration: 5 }),
    newBlock("en", { title: "Discussion", duration: 30 }),
    newBlock("en", { title: "Closing", duration: 10 }),
  ];
  const session = quickMeetingSession(invitation, "en", now, blocks);
  const view = timerView(session, now);
  assert.equal(view.block?.title, "Discussion");
  assert.equal(view.remainingSeconds, 25 * 60);
  assert.equal(session.run.runStartedAt, Date.parse(invitation.start));
  assert.equal(totalDuration(session), 45);
});
test("expired invitations finish rather than restarting for a full meeting", () => {
  const session = quickMeetingSession(
    invitation,
    "fr",
    Date.parse("2026-11-04T14:00:00Z"),
  );
  assert.equal(session.run.status, "finished");
});
test("AI analysis uses only explicit invitation text and rejects overlong content", () => {
  assert.match(quickMeetingPrompt(invitation, "en"), /Decision meeting/);
  assert.match(quickMeetingPrompt(invitation, "fr"), /Welcome 5 min/);
  assert.throws(
    () => quickMeetingPrompt({ ...invitation, body: "x".repeat(8001) }, "fr"),
    /MEETING_AI_LIMIT/,
  );
});
