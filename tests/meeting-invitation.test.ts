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
    modifiedAllDay?: boolean;
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
        minutes(
          options.modifiedAllDay
            ? "2026-11-04T00:00:00Z"
            : "2026-11-04T14:30:00Z",
        ),
        minutes(
          options.modifiedAllDay
            ? "2026-11-05T00:00:00Z"
            : "2026-11-04T15:15:00Z",
        ),
        minutes("2026-11-04T14:00:00Z"),
      ].forEach(u32);
      u16(options.modifiedAllDay ? 0x80 : 0);
      if (options.modifiedAllDay) u32(1);
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
test("ICS accepts one detached occurrence using its explicit changed schedule", async () => {
  for (const schedule of [
    ["DTSTART:20261104T143000Z", "DTEND:20261104T151500Z"],
    [
      "DTSTART;TZID=Europe/Zurich:20261104T153000",
      "DTEND;TZID=Europe/Zurich:20261104T161500",
    ],
  ]) {
    const parsed = await parseMeetingInvitation(
      "occurrence.ics",
      calendar(
        ...event(
          "RECURRENCE-ID:20261028T130000Z",
          ...schedule,
          "DESCRIPTION:Only this occurrence.",
        ),
      ),
      now,
    );
    assert.deepEqual(parsed, {
      title: "Synthetic planning meeting",
      start: "2026-11-04T14:30:00.000Z",
      end: "2026-11-04T15:15:00.000Z",
      body: "Only this occurrence.",
    });
  }
});
test("ICS detached occurrences keep cancellation, schedule and range safeguards", async () => {
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
    [["DTSTART:20261104T130000Z"], "MEETING_NO_TIME"],
    [["DTEND:20261104T134500Z"], "MEETING_NO_TIME"],
    [
      [
        "DTSTART:20261104T130000Z",
        "DTEND:20261104T134500Z",
        "RRULE:FREQ=WEEKLY",
      ],
      "MEETING_RECURRENCE_UNSUPPORTED",
    ],
  ] as const)
    await assert.rejects(
      parseMeetingInvitation(
        "occurrence.ics",
        calendar(...event("RECURRENCE-ID:20261104T130000Z", ...lines)),
        now,
      ),
      rejects(code),
    );
  await assert.rejects(
    parseMeetingInvitation(
      "occurrence.ics",
      calendar(
        ...event(
          "RECURRENCE-ID;RANGE=THISANDFUTURE:20261104T130000Z",
          "DTSTART:20261104T130000Z",
          "DTEND:20261104T134500Z",
        ),
      ),
      now,
    ),
    rejects("MEETING_RECURRENCE_UNSUPPORTED"),
  );
});
test("ICS does not choose between multiple detached occurrences without a series master", async () => {
  await assert.rejects(
    parseMeetingInvitation(
      "occurrences.ics",
      calendar(
        ...event(
          "RECURRENCE-ID:20261104T130000Z",
          "DTSTART:20261104T130000Z",
          "DTEND:20261104T134500Z",
        ),
        ...event(
          "RECURRENCE-ID:20261111T130000Z",
          "DTSTART:20261111T130000Z",
          "DTEND:20261111T134500Z",
        ),
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
test("ICS exception selection uses the series day for equivalent instants in different timezones", async () => {
  for (const start of [
    "DTSTART;TZID=America/Los_Angeles:20261103T203000",
    "DTSTART;TZID=Asia/Tokyo:20261104T133000",
    "DTSTART:20261104T043000Z",
  ]) {
    const parsed = await parseMeetingInvitation(
      "meeting.ics",
      calendar(
        ...event(
          "DTSTART:20261028T020000Z",
          "DURATION:PT45M",
          "RRULE:FREQ=WEEKLY;COUNT=4",
        ),
        ...event("RECURRENCE-ID:20261104T020000Z", start, "DURATION:PT45M"),
      ),
      Date.parse("2026-11-04T02:00:00Z"),
    );
    assert.equal(parsed.start, "2026-11-04T04:30:00.000Z");
    assert.equal(parsed.end, "2026-11-04T05:15:00.000Z");
    assert.equal(parsed.recurrence, "today");
  }
  const nonUtcSeries = await parseMeetingInvitation(
    "meeting.ics",
    calendar(
      ...event(
        "DTSTART;TZID=Europe/Zurich:20261028T003000",
        "DURATION:PT45M",
        "RRULE:FREQ=WEEKLY;COUNT=4",
      ),
      ...event(
        "RECURRENCE-ID;TZID=Europe/Zurich:20261104T003000",
        "DTSTART:20261103T233000Z",
        "DURATION:PT45M",
      ),
    ),
    Date.parse("2026-11-04T00:00:00Z"),
  );
  assert.equal(nonUtcSeries.start, "2026-11-03T23:30:00.000Z");
  assert.equal(nonUtcSeries.recurrence, "today");
});
test("ICS exception dates moved before or after today are classified in the series timezone", async () => {
  for (const [start, expected] of [
    ["DTSTART;TZID=Asia/Tokyo:20261104T003000", "2026-11-11T02:00:00.000Z"],
    [
      "DTSTART;TZID=America/Los_Angeles:20261104T203000",
      "2026-11-05T04:30:00.000Z",
    ],
  ]) {
    const parsed = await parseMeetingInvitation(
      "meeting.ics",
      calendar(
        ...event(
          "DTSTART:20261028T020000Z",
          "DURATION:PT45M",
          "RRULE:FREQ=WEEKLY;COUNT=4",
        ),
        ...event("RECURRENCE-ID:20261104T020000Z", start, "DURATION:PT45M"),
      ),
      Date.parse("2026-11-04T02:00:00Z"),
    );
    assert.equal(parsed.start, expected);
    assert.equal(parsed.recurrence, "next");
  }
});
test("ICS orders changed occurrences by instant and detects same-series-day ambiguity across zones", async () => {
  const base = event(
    "DTSTART:20261028T020000Z",
    "DURATION:PT45M",
    "RRULE:FREQ=WEEKLY;COUNT=4",
  );
  const later = event(
    "RECURRENCE-ID:20261111T020000Z",
    "DTSTART;TZID=America/Los_Angeles:20261104T203000",
    "DURATION:PT45M",
  );
  const earlier = event(
    "RECURRENCE-ID:20261104T020000Z",
    "DTSTART;TZID=Asia/Tokyo:20261105T003000",
    "DURATION:PT45M",
  );
  const parsed = await parseMeetingInvitation(
    "meeting.ics",
    calendar(...base, ...later, ...earlier),
    Date.parse("2026-11-04T02:00:00Z"),
  );
  assert.equal(parsed.start, "2026-11-04T15:30:00.000Z");
  assert.equal(parsed.recurrence, "today");
  await assert.rejects(
    parseMeetingInvitation(
      "meeting.ics",
      calendar(
        ...base,
        ...event(
          "RECURRENCE-ID:20261104T020000Z",
          "DTSTART;TZID=America/Los_Angeles:20261103T203000",
          "DURATION:PT45M",
        ),
        ...event(
          "RECURRENCE-ID:20261111T020000Z",
          "DTSTART;TZID=Asia/Tokyo:20261104T133000",
          "DURATION:PT45M",
        ),
      ),
      Date.parse("2026-11-04T02:00:00Z"),
    ),
    rejects("MEETING_AMBIGUOUS_TIME"),
  );
});
test("ICS changed occurrences still reject nonexistent and ambiguous daylight-saving times", async () => {
  for (const [first, changed, code] of [
    ["20260322", "20260329", "MEETING_TIMEZONE"],
    ["20261018", "20261025", "MEETING_AMBIGUOUS_TIME"],
  ])
    await assert.rejects(
      parseMeetingInvitation(
        "meeting.ics",
        calendar(
          ...event(
            `DTSTART:${first}T020000Z`,
            "DURATION:PT45M",
            "RRULE:FREQ=WEEKLY;COUNT=4",
          ),
          ...event(
            `RECURRENCE-ID:${changed}T020000Z`,
            `DTSTART;TZID=Europe/Zurich:${changed}T023000`,
            "DURATION:PT45M",
          ),
        ),
        Date.parse(
          `${changed.slice(0, 4)}-${changed.slice(4, 6)}-${changed.slice(6)}T00:00:00Z`,
        ),
      ),
      rejects(code),
    );
});
test("ICS keeps today's valid occurrence without resolving tomorrow's daylight-saving gap or overlap", async () => {
  for (const [first, current, expected] of [
    ["20260327", "2026-03-28T12:00:00Z", "2026-03-28T01:30:00.000Z"],
    ["20261023", "2026-10-24T12:00:00Z", "2026-10-24T00:30:00.000Z"],
  ]) {
    const parsed = await parseMeetingInvitation(
      "meeting.ics",
      calendar(
        ...event(
          `DTSTART;TZID=Europe/Zurich:${first}T023000`,
          "DURATION:PT45M",
          "RRULE:FREQ=DAILY;COUNT=4",
        ),
      ),
      Date.parse(current),
    );
    assert.equal(parsed.start, expected);
    assert.equal(parsed.recurrence, "today");
  }
});
test("ICS ignores invalid DST exceptions strictly before or after the selected occurrence day", async () => {
  for (const [first, changed, checks] of [
    [
      "20260327",
      "20260329",
      [
        ["2026-03-26T12:00:00Z", "2026-03-27T08:00:00.000Z", "next"],
        ["2026-03-28T12:00:00Z", "2026-03-28T08:00:00.000Z", "today"],
        ["2026-03-30T12:00:00Z", "2026-03-30T07:00:00.000Z", "today"],
      ],
    ],
    [
      "20261023",
      "20261025",
      [
        ["2026-10-22T12:00:00Z", "2026-10-23T07:00:00.000Z", "next"],
        ["2026-10-24T12:00:00Z", "2026-10-24T07:00:00.000Z", "today"],
        ["2026-10-26T12:00:00Z", "2026-10-26T08:00:00.000Z", "today"],
      ],
    ],
  ] as const) {
    const bytes = calendar(
      ...event(
        `DTSTART;TZID=Europe/Zurich:${first}T090000`,
        "DURATION:PT45M",
        "RRULE:FREQ=DAILY;COUNT=6",
      ),
      ...event(
        `RECURRENCE-ID;TZID=Europe/Zurich:${changed}T090000`,
        `DTSTART;TZID=Europe/Zurich:${changed}T023000`,
        "DURATION:PT45M",
      ),
    );
    for (const [current, expected, recurrence] of checks) {
      const parsed = await parseMeetingInvitation(
        "meeting.ics",
        bytes,
        Date.parse(current),
      );
      assert.equal(parsed.start, expected);
      assert.equal(parsed.recurrence, recurrence);
    }
  }
});
test("ICS defers invalid exceptions using all possible days across the series timezone midnight", async () => {
  for (const [first, changed, before, firstDay, lastDay, after, code] of [
    [
      "20260327",
      "20260329",
      "2026-03-27",
      "2026-03-28",
      "2026-03-29",
      "2026-03-30",
      "MEETING_TIMEZONE",
    ],
    [
      "20261023",
      "20261025",
      "2026-10-23",
      "2026-10-24",
      "2026-10-25",
      "2026-10-26",
      "MEETING_AMBIGUOUS_TIME",
    ],
  ]) {
    const bytes = calendar(
      ...event(
        `DTSTART;TZID=Atlantic/Cape_Verde:${first}T090000`,
        "DURATION:PT45M",
        "RRULE:FREQ=DAILY;COUNT=6",
      ),
      ...event(
        `RECURRENCE-ID;TZID=Atlantic/Cape_Verde:${changed}T090000`,
        `DTSTART;TZID=Europe/Zurich:${changed}T023000`,
        "DURATION:PT45M",
      ),
    );
    // The Zurich transition's two candidate instants fall either side of
    // midnight in the series timezone. Neither possible day may be ignored.
    for (const current of [firstDay, lastDay])
      await assert.rejects(
        parseMeetingInvitation(
          "meeting.ics",
          bytes,
          Date.parse(`${current}T12:00:00Z`),
        ),
        rejects(code),
      );
    for (const current of [before, after]) {
      const parsed = await parseMeetingInvitation(
        "meeting.ics",
        bytes,
        Date.parse(`${current}T12:00:00Z`),
      );
      assert.equal(parsed.start, `${current}T10:00:00.000Z`);
      assert.equal(parsed.recurrence, "today");
    }
  }
});
test("ICS rejects an invalid next exception before a later valid occurrence even when today has no meeting", async () => {
  await assert.rejects(
    parseMeetingInvitation(
      "meeting.ics",
      calendar(
        ...event(
          "DTSTART;TZID=Europe/Zurich:20261018T090000",
          "DURATION:PT45M",
          "RRULE:FREQ=WEEKLY;COUNT=4",
        ),
        ...event(
          "RECURRENCE-ID;TZID=Europe/Zurich:20261025T090000",
          "DTSTART;TZID=Europe/Zurich:20261025T023000",
          "DURATION:PT45M",
        ),
      ),
      Date.parse("2026-10-24T12:00:00Z"),
    ),
    rejects("MEETING_AMBIGUOUS_TIME"),
  );
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
test("MSG all-day exceptions reject only the selected occurrence", async () => {
  const bytes = msg({ recurring: true, modified: true, modifiedAllDay: true });
  for (const date of ["2026-10-28", "2026-11-11"]) {
    const parsed = await parseMeetingInvitation(
      "meeting.msg",
      bytes,
      Date.parse(`${date}T15:00:00Z`),
    );
    assert.equal(parsed.start, `${date}T13:00:00.000Z`);
    assert.equal(parsed.recurrence, "today");
  }
  for (const date of ["2026-11-03", "2026-11-04"])
    await assert.rejects(
      parseMeetingInvitation(
        "meeting.msg",
        bytes,
        Date.parse(`${date}T15:00:00Z`),
      ),
      rejects("MEETING_ALL_DAY"),
    );
});
test("ICS all-day exceptions reject only the selected occurrence and ignore cancelled instances", async () => {
  for (const cancelled of [false, true]) {
    const bytes = calendar(
      ...event(
        "DTSTART;TZID=Europe/Zurich:20261028T140000",
        "DURATION:PT45M",
        "RRULE:FREQ=WEEKLY;COUNT=4",
      ),
      ...event(
        "RECURRENCE-ID;TZID=Europe/Zurich:20261104T140000",
        "DTSTART;VALUE=DATE:20261104",
        "DTEND;VALUE=DATE:20261105",
        ...(cancelled ? ["STATUS:CANCELLED"] : []),
      ),
    );
    for (const date of ["2026-10-28", "2026-11-11"]) {
      const parsed = await parseMeetingInvitation(
        "meeting.ics",
        bytes,
        Date.parse(`${date}T15:00:00Z`),
      );
      assert.equal(parsed.start, `${date}T13:00:00.000Z`);
      assert.equal(parsed.recurrence, "today");
    }
    for (const date of ["2026-11-03", "2026-11-04"]) {
      const parsing = parseMeetingInvitation(
        "meeting.ics",
        bytes,
        Date.parse(`${date}T15:00:00Z`),
      );
      if (!cancelled) await assert.rejects(parsing, rejects("MEETING_ALL_DAY"));
      else {
        const parsed = await parsing;
        assert.equal(parsed.start, "2026-11-11T13:00:00.000Z");
        assert.equal(parsed.recurrence, "next");
      }
    }
  }
});
test("ICS all-day exceptions retain strict calendar, recurrence identity and value-type checks", async () => {
  for (const [lines, code] of [
    [
      [
        "RECURRENCE-ID;TZID=Europe/Zurich:20261104T140000",
        "DTSTART;VALUE=DATE:20270230",
        "DTEND;VALUE=DATE:20270301",
      ],
      "MEETING_INVALID",
    ],
    [
      [
        "RECURRENCE-ID;VALUE=DATE:20261104",
        "DTSTART;VALUE=DATE:20261104",
        "DTEND;VALUE=DATE:20261105",
      ],
      "MEETING_ALL_DAY",
    ],
    [
      [
        "RECURRENCE-ID;TZID=Europe/Zurich:20261104T140000",
        "DTSTART;TZID=Europe/Zurich:20261104T140000",
        "DTEND;VALUE=DATE:20261105",
      ],
      "MEETING_ALL_DAY",
    ],
    [
      [
        "RECURRENCE-ID;TZID=Europe/Zurich:20261104T140000",
        "DTSTART;VALUE=DATE:20261104",
        "DTEND:20261105T140000Z",
      ],
      "MEETING_INVALID",
    ],
    [
      [
        "RECURRENCE-ID;TZID=Europe/Zurich:20261104T140000",
        "DTSTART;VALUE=DATE;TZID=Unknown/Zone:20261104",
        "DTEND;VALUE=DATE:20261105",
      ],
      "MEETING_INVALID",
    ],
  ] as const) {
    await assert.rejects(
      parseMeetingInvitation(
        "meeting.ics",
        calendar(
          ...event(
            "DTSTART;TZID=Europe/Zurich:20261028T140000",
            "DURATION:PT45M",
            "RRULE:FREQ=WEEKLY;COUNT=4",
          ),
          ...event(...lines),
        ),
        Date.parse("2026-10-28T15:00:00Z"),
      ),
      rejects(code),
    );
  }
});
test("ICS moved all-day exceptions use their new calendar date and the series local day", async () => {
  const bytes = calendar(
    ...event(
      "DTSTART;TZID=Asia/Tokyo:20261103T140000",
      "DURATION:PT45M",
      "RRULE:FREQ=DAILY;COUNT=7",
    ),
    ...event(
      "RECURRENCE-ID;TZID=Asia/Tokyo:20261105T140000",
      "DTSTART;VALUE=DATE:20261107",
      "DTEND;VALUE=DATE:20261108",
    ),
  );
  // UTC is still November 4, but the series is already on November 5. Its
  // occurrence moved to November 7, so the next timed date is November 6.
  const parsed = await parseMeetingInvitation(
    "meeting.ics",
    bytes,
    Date.parse("2026-11-04T16:00:00Z"),
  );
  assert.equal(parsed.start, "2026-11-06T05:00:00.000Z");
  assert.equal(parsed.recurrence, "next");
  await assert.rejects(
    parseMeetingInvitation(
      "meeting.ics",
      bytes,
      Date.parse("2026-11-06T16:00:00Z"),
    ),
    rejects("MEETING_ALL_DAY"),
  );
  const after = await parseMeetingInvitation(
    "meeting.ics",
    bytes,
    Date.parse("2026-11-07T16:00:00Z"),
  );
  assert.equal(after.start, "2026-11-08T05:00:00.000Z");
  assert.equal(after.recurrence, "today");
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
