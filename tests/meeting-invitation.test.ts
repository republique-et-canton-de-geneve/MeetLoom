import assert from "node:assert/strict";
import test from "node:test";
import { burn, type Entry } from "@kenjiuno/msgreader/lib/Burner.js";
import {
  parseMeetingInvitation,
  MeetingInvitationError,
  MAX_MEETING_BYTES,
  meetingInvitationMessage,
} from "../shared/meeting-invitation.js";

const now = Date.parse("2026-11-04T15:00:00Z");
test("the parsing worker accepts only bounded binary messages with a finite clock", () => {
  const message = { name: "meeting.ics", bytes: new ArrayBuffer(8), now };
  assert.deepEqual(meetingInvitationMessage(message), message);
  for (const invalid of [
    null,
    "text",
    {},
    { ...message, name: 2 },
    { ...message, name: "x".repeat(1025) },
    { ...message, bytes: new Uint8Array(8) },
    { ...message, bytes: new ArrayBuffer(0) },
    { ...message, now: NaN },
  ])
    assert.throws(
      () => meetingInvitationMessage(invalid),
      (error: unknown) =>
        error instanceof MeetingInvitationError &&
        error.code === "MEETING_INVALID",
    );
  assert.throws(
    () =>
      meetingInvitationMessage({
        ...message,
        bytes: new ArrayBuffer(MAX_MEETING_BYTES + 1),
      }),
    (error: unknown) =>
      error instanceof MeetingInvitationError &&
      error.code === "MEETING_FILE_LIMIT",
  );
});
const encode = (text: string) => new TextEncoder().encode(text);
const calendar = (...lines: string[]) =>
  encode(
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Synthetic tests//EN",
      ...lines,
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
const event = (...lines: string[]) => [
  "BEGIN:VEVENT",
  "UID:synthetic-meeting",
  "SUMMARY:Synthetic planning meeting",
  ...lines,
  "END:VEVENT",
];
const rejects = (code: string) => (error: unknown) =>
  error instanceof MeetingInvitationError &&
  error.code === code &&
  error.message === code;

// All bytes are generated from invented content. No real invitation is a fixture.
function msg(
  options: {
    recurring?: boolean;
    deleted?: boolean;
    modified?: boolean;
    allDay?: boolean;
    cancelled?: boolean;
    body?: string;
    ordinaryMail?: boolean;
  } = {},
) {
  const entries: Entry[] = [
    { name: "Root Entry", type: 5, length: 0, children: [] },
    { name: "__nameid_version1.0", type: 1, length: 0, children: [] },
  ];
  entries[0].children!.push(1);
  const add = (name: string, data: Uint8Array, parent = 0) => {
    const bytes = Uint8Array.from(data);
    const index = entries.length;
    entries.push({
      name,
      type: 2,
      length: bytes.length,
      binaryProvider: () => bytes,
    });
    entries[parent].children!.push(index);
  };
  const string = (tag: string, text: string) =>
    add(`__substg1.0_${tag}001F`, Buffer.from(text, "utf16le"));
  string("0037", "Synthetic planning meeting");
  string("001A", options.ordinaryMail ? "IPM.Note" : "IPM.Appointment");
  string("1000", options.body ?? "Invented meeting notes.");
  const lids = [0x820d, 0x820e, 0x8215, 0x8217, 0x8223, 0x8233, 0x8216];
  const map = Buffer.alloc(lids.length * 8);
  lids.forEach((lid, index) => {
    map.writeUInt32LE(lid, index * 8);
    map.writeUInt16LE(6, index * 8 + 4);
    map.writeUInt16LE(index, index * 8 + 6);
  });
  add(
    "__substg1.0_00020102",
    Buffer.from("0220060000000000c000000000000046", "hex"),
    1,
  );
  add("__substg1.0_00030102", map, 1);
  add("__substg1.0_00040102", Buffer.alloc(0), 1);
  const properties: Buffer[] = [];
  const number = (index: number, type: number, value: number | bigint) => {
    const property = Buffer.alloc(16);
    property.writeUInt32LE((0x8000 + index) * 0x10000 + type);
    if (type === 0x40) property.writeBigUInt64LE(BigInt(value), 8);
    else property.writeUInt32LE(Number(value), 8);
    properties.push(property);
  };
  const filetime = (date: string) =>
    BigInt(Date.parse(date) + 11_644_473_600_000) * 10_000n;
  number(
    0,
    0x40,
    filetime(
      options.recurring ? "2026-10-28T13:00:00Z" : "2026-11-04T13:00:00Z",
    ),
  );
  number(
    1,
    0x40,
    filetime(
      options.recurring ? "2026-10-28T13:45:00Z" : "2026-11-04T13:45:00Z",
    ),
  );
  number(2, 0xb, options.allDay ? 1 : 0);
  number(3, 3, options.cancelled ? 4 : 0);
  number(4, 0xb, options.recurring ? 1 : 0);
  add(
    "__properties_version1.0",
    Buffer.concat([Buffer.alloc(32), ...properties]),
  );
  if (options.recurring) {
    const tz = Buffer.alloc(48);
    tz.writeInt32LE(-60, 0);
    tz.writeInt32LE(-60, 8);
    [0, 10, 0, 5, 3, 0, 0, 0].forEach((v, i) =>
      tz.writeUInt16LE(v, 14 + i * 2),
    );
    [0, 3, 0, 5, 2, 0, 0, 0].forEach((v, i) => tz.writeUInt16LE(v, 32 + i * 2));
    add("__substg1.0_80050102", tz);
    const chunks: Buffer[] = [];
    const u16 = (value: number) => {
      const b = Buffer.alloc(2);
      b.writeUInt16LE(value);
      chunks.push(b);
    };
    const u32 = (value: number) => {
      const b = Buffer.alloc(4);
      b.writeUInt32LE(value);
      chunks.push(b);
    };
    const minutes = (date: string) =>
      (Date.parse(date) + 11_644_473_600_000) / 60_000;
    [0x3004, 0x3004, 8203, 1, 0].forEach(u16);
    [0, 1, 0, 8, 8227, 10, 1].forEach(u32);
    u32(options.deleted || options.modified ? 1 : 0);
    if (options.deleted || options.modified)
      u32(minutes("2026-11-04T00:00:00Z"));
    u32(options.modified ? 1 : 0);
    if (options.modified) u32(minutes("2026-11-04T00:00:00Z"));
    [
      minutes("2026-10-28T00:00:00Z"),
      minutes("2099-12-31T00:00:00Z"),
      0x3006,
      0x3006,
      840,
      885,
    ].forEach(u32);
    u16(options.modified ? 1 : 0);
    if (options.modified) {
      [
        minutes("2026-11-04T14:30:00Z"),
        minutes("2026-11-04T15:15:00Z"),
        minutes("2026-11-04T14:00:00Z"),
      ].forEach(u32);
      u16(0);
    }
    u32(0);
    if (options.modified) u32(0);
    u32(0);
    add("__substg1.0_80060102", Buffer.concat(chunks));
  }
  return burn(entries);
}

test("ICS parses absolute times and plain folded/escaped content without exposing other properties", async () => {
  const parsed = await parseMeetingInvitation(
    "meeting.ICS",
    calendar(
      ...event(
        "DTSTART:20261104T130000Z",
        "DTEND:20261104T134500Z",
        "DESCRIPTION:Line one\\nLine two\\, with",
        "  a folded ending",
        "ATTENDEE:mailto:private@example.test",
        "ATTACH:https://example.invalid/private",
      ),
    ),
    now,
  );
  assert.deepEqual(parsed, {
    title: "Synthetic planning meeting",
    start: "2026-11-04T13:00:00.000Z",
    end: "2026-11-04T13:45:00.000Z",
    body: "Line one\nLine two, with a folded ending",
  });
});
test("ICS uses the invitation timezone, not the computer timezone, in winter and summer", async () => {
  for (const [date, expected] of [
    ["20261104", "2026-11-04T13:00:00.000Z"],
    ["20260701", "2026-07-01T12:00:00.000Z"],
  ]) {
    const parsed = await parseMeetingInvitation(
      "meeting.ics",
      calendar(
        ...event(`DTSTART;TZID=Europe/Zurich:${date}T140000`, "DURATION:PT45M"),
      ),
      now,
    );
    assert.equal(parsed.start, expected);
    assert.equal(
      Date.parse(parsed.end) - Date.parse(parsed.start),
      45 * 60_000,
    );
  }
});
test("ICS rejects cancelled/all-day/floating/ambiguous/nonexistent/broken calendar dates", async () => {
  for (const [lines, code] of [
    [
      [
        "DTSTART:20261104T130000Z",
        "DTEND:20261104T134500Z",
        "STATUS:CANCELLED",
      ],
      "MEETING_CANCELLED",
    ],
    [
      ["DTSTART;VALUE=DATE:20261104", "DTEND;VALUE=DATE:20261105"],
      "MEETING_ALL_DAY",
    ],
    [["DTSTART:20261104T140000", "DTEND:20261104T144500"], "MEETING_TIMEZONE"],
    [
      ["DTSTART;TZID=Europe/Zurich:20261025T023000", "DURATION:PT45M"],
      "MEETING_AMBIGUOUS_TIME",
    ],
    [
      ["DTSTART;TZID=Europe/Zurich:20260329T023000", "DURATION:PT45M"],
      "MEETING_TIMEZONE",
    ],
    [["DTSTART:20260230T130000Z", "DTEND:20260302T134500Z"], "MEETING_INVALID"],
    [
      ["DTSTART:20261104T130000Z", "DTEND:20261104T120000Z"],
      "MEETING_INVALID_RANGE",
    ],
  ] as const)
    await assert.rejects(
      parseMeetingInvitation("meeting.ics", calendar(...event(...lines)), now),
      rejects(code),
    );
});
test("ICS rejects unrelated multiple events instead of silently selecting one", async () => {
  await assert.rejects(
    parseMeetingInvitation(
      "meeting.ics",
      calendar(
        ...event("DTSTART:20261104T130000Z", "DURATION:PT45M"),
        ...event("DTSTART:20261105T130000Z", "DURATION:PT45M"),
      ),
      now,
    ),
    rejects("MEETING_MULTIPLE_EVENTS"),
  );
});
test("ICS duration preserves elapsed hours across both daylight-saving changes", async () => {
  for (const [start, duration, expected] of [
    ["20260329T013000", "PT2H", 120],
    ["20261025T003000", "PT3H", 180],
  ] as const) {
    const parsed = await parseMeetingInvitation(
      "meeting.ics",
      calendar(
        ...event(`DTSTART;TZID=Europe/Zurich:${start}`, `DURATION:${duration}`),
      ),
      now,
    );
    assert.equal(
      (Date.parse(parsed.end) - Date.parse(parsed.start)) / 60_000,
      expected,
    );
  }
});
test("ICS refuses multiple occurrences on one day instead of choosing a past occurrence arbitrarily", async () => {
  await assert.rejects(
    parseMeetingInvitation(
      "meeting.ics",
      calendar(
        ...event(
          "DTSTART:20261104T090000Z",
          "DURATION:PT30M",
          "RRULE:FREQ=DAILY;BYHOUR=9,14;COUNT=5",
        ),
      ),
      now,
    ),
    rejects("MEETING_AMBIGUOUS_TIME"),
  );
});
test("ICS weekly series resolves today even after the meeting ended, then its next actual occurrence", async () => {
  const bytes = calendar(
    ...event(
      "DTSTART;TZID=Europe/Zurich:20261028T140000",
      "DURATION:PT45M",
      "RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=4",
    ),
  );
  const today = await parseMeetingInvitation("meeting.ics", bytes, now);
  assert.equal(today.start, "2026-11-04T13:00:00.000Z");
  assert.equal(today.recurrence, "today");
  const next = await parseMeetingInvitation(
    "meeting.ics",
    bytes,
    Date.parse("2026-11-05T12:00:00Z"),
  );
  assert.equal(next.start, "2026-11-11T13:00:00.000Z");
  assert.equal(next.recurrence, "next");
});
test("ICS recurrence applies excluded dates and explicitly moved occurrences", async () => {
  const base = event(
    "DTSTART;TZID=Europe/Zurich:20261028T140000",
    "DURATION:PT45M",
    "RRULE:FREQ=WEEKLY;COUNT=4",
  );
  const changed = event(
    "RECURRENCE-ID;TZID=Europe/Zurich:20261104T140000",
    "DTSTART;TZID=Europe/Zurich:20261104T153000",
    "DURATION:PT30M",
  );
  const moved = await parseMeetingInvitation(
    "meeting.ics",
    calendar(...base, ...changed),
    now,
  );
  assert.equal(moved.start, "2026-11-04T14:30:00.000Z");
  assert.equal(moved.end, "2026-11-04T15:00:00.000Z");
  const excluded = await parseMeetingInvitation(
    "meeting.ics",
    calendar(
      ...event(
        "DTSTART;TZID=Europe/Zurich:20261028T140000",
        "DURATION:PT45M",
        "RRULE:FREQ=WEEKLY;COUNT=4",
        "EXDATE;TZID=Europe/Zurich:20261104T140000",
      ),
    ),
    now,
  );
  assert.equal(excluded.start, "2026-11-11T13:00:00.000Z");
});
test("MSG uses canonical appointment times and returns only the permitted local preview fields", async () => {
  assert.deepEqual(await parseMeetingInvitation("meeting.msg", msg(), now), {
    title: "Synthetic planning meeting",
    start: "2026-11-04T13:00:00.000Z",
    end: "2026-11-04T13:45:00.000Z",
    body: "Invented meeting notes.",
  });
  await assert.rejects(
    parseMeetingInvitation("mail.msg", msg({ ordinaryMail: true }), now),
    rejects("MEETING_NO_EVENT"),
  );
});
test("MSG rejects all-day and cancelled appointments from named MAPI properties", async () => {
  await assert.rejects(
    parseMeetingInvitation("meeting.msg", msg({ allDay: true }), now),
    rejects("MEETING_ALL_DAY"),
  );
  await assert.rejects(
    parseMeetingInvitation("meeting.msg", msg({ cancelled: true }), now),
    rejects("MEETING_CANCELLED"),
  );
});
test("MSG recurring series resolves today with its embedded timezone, not its original series date", async () => {
  const parsed = await parseMeetingInvitation(
    "meeting.msg",
    msg({ recurring: true }),
    now,
  );
  assert.equal(parsed.start, "2026-11-04T13:00:00.000Z");
  assert.equal(parsed.end, "2026-11-04T13:45:00.000Z");
  assert.equal(parsed.recurrence, "today");
  const summer = await parseMeetingInvitation(
    "meeting.msg",
    msg({ recurring: true }),
    Date.parse("2027-07-07T15:00:00Z"),
  );
  assert.equal(summer.start, "2027-07-07T12:00:00.000Z");
});
test("MSG recurrence skips deleted occurrences and uses changed start/end times", async () => {
  const deleted = await parseMeetingInvitation(
    "meeting.msg",
    msg({ recurring: true, deleted: true }),
    now,
  );
  assert.equal(deleted.start, "2026-11-11T13:00:00.000Z");
  assert.equal(deleted.recurrence, "next");
  const changed = await parseMeetingInvitation(
    "meeting.msg",
    msg({ recurring: true, modified: true }),
    now,
  );
  assert.equal(changed.start, "2026-11-04T13:30:00.000Z");
  assert.equal(changed.end, "2026-11-04T14:15:00.000Z");
});
test("file/structure limits and malformed inputs fail with content-free machine errors", async () => {
  await assert.rejects(
    parseMeetingInvitation(
      "large.msg",
      new Uint8Array(MAX_MEETING_BYTES + 1),
      now,
    ),
    rejects("MEETING_FILE_LIMIT"),
  );
  await assert.rejects(
    parseMeetingInvitation(
      "meeting.exe",
      encode("private malformed body"),
      now,
    ),
    rejects("MEETING_FORMAT"),
  );
  await assert.rejects(
    parseMeetingInvitation(
      "meeting.msg",
      encode("private malformed body"),
      now,
    ),
    rejects("MEETING_INVALID"),
  );
  await assert.rejects(
    parseMeetingInvitation("meeting.ics", new Uint8Array([0xff]), now),
    rejects("MEETING_INVALID"),
  );
  await assert.rejects(
    parseMeetingInvitation(
      "meeting.ics",
      encode("BEGIN:VCALENDAR\n".repeat(9)),
      now,
    ),
    rejects("MEETING_COMPLEXITY"),
  );
});
