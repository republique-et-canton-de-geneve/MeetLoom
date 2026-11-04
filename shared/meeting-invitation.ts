import type {
  FieldsData,
  TzReg,
  TransitionSystemTime,
  RecurrencePattern,
} from "@kenjiuno/msgreader";
import type ICAL from "ical.js";
type IcalTime = InstanceType<typeof ICAL.Time>;

export const MAX_MEETING_BYTES = 10 * 1024 * 1024;
/** Validate the private worker's message boundary before decoding any bytes. */
export function meetingInvitationMessage(value: unknown): {
  name: string;
  bytes: ArrayBuffer;
  now: number;
} {
  const data = value as Record<string, unknown> | null;
  if (
    !data ||
    typeof data !== "object" ||
    typeof data.name !== "string" ||
    !data.name.length ||
    data.name.length > 1024 ||
    !(data.bytes instanceof ArrayBuffer) ||
    !data.bytes.byteLength ||
    typeof data.now !== "number" ||
    !Number.isFinite(data.now)
  )
    throw new MeetingInvitationError("MEETING_INVALID");
  if (data.bytes.byteLength > MAX_MEETING_BYTES)
    throw new MeetingInvitationError("MEETING_FILE_LIMIT");
  return { name: data.name, bytes: data.bytes, now: data.now };
}
export interface MeetingInvitation {
  title: string;
  start: string;
  end: string;
  body: string;
  recurrence?: "today" | "next";
}
export type MeetingInvitationErrorCode =
  | "MEETING_FILE_LIMIT"
  | "MEETING_FORMAT"
  | "MEETING_INVALID"
  | "MEETING_NO_EVENT"
  | "MEETING_MULTIPLE_EVENTS"
  | "MEETING_NO_TIME"
  | "MEETING_TIMEZONE"
  | "MEETING_AMBIGUOUS_TIME"
  | "MEETING_ALL_DAY"
  | "MEETING_CANCELLED"
  | "MEETING_RECURRENCE_UNSUPPORTED"
  | "MEETING_NO_OCCURRENCE"
  | "MEETING_INVALID_RANGE"
  | "MEETING_COMPLEXITY"
  | "MEETING_TIMEOUT"
  | "MEETING_READ_FAILED";
export class MeetingInvitationError extends Error {
  constructor(public readonly code: MeetingInvitationErrorCode) {
    super(code);
    this.name = "MeetingInvitationError";
  }
}
function fail(code: MeetingInvitationErrorCode): never {
  throw new MeetingInvitationError(code);
}
const MINUTE = 60_000;
const DAY = 86_400_000;
const FILETIME_EPOCH = -11_644_473_600_000;
const APPOINTMENT_SET = "00062002-0000-0000-c000-000000000046";
type Zone = { offsetAt(instant: number): number };
const UTC: Zone = { offsetAt: () => 0 };
const dayOf = (wall: number) => Math.floor(wall / DAY) * DAY;
const fromMinutes = (minutes: number) => FILETIME_EPOCH + minutes * MINUTE;
const wallAt = (instant: number, zone: Zone) =>
  instant + zone.offsetAt(instant) * MINUTE;

/** Resolve a wall clock without guessing either side of a daylight-saving overlap. */
function instantAt(wall: number, zone: Zone): number {
  const offsets = new Set(
    [-2, -1, 0, 1, 2].map((days) => zone.offsetAt(wall + days * DAY)),
  );
  const matches = [...offsets]
    .map((offset) => wall - offset * MINUTE)
    .filter((instant) => wallAt(instant, zone) === wall);
  if (matches.length > 1) fail("MEETING_AMBIGUOUS_TIME");
  if (matches.length !== 1) fail("MEETING_TIMEZONE");
  return matches[0];
}
function result(
  title: unknown,
  body: unknown,
  start: number,
  end: number,
  recurrence?: "today" | "next",
): MeetingInvitation {
  if (!Number.isFinite(start) || !Number.isFinite(end)) fail("MEETING_NO_TIME");
  if (
    start < Date.UTC(1970, 0, 1) ||
    end > Date.UTC(2200, 0, 1) ||
    end <= start ||
    end - start > 7 * DAY
  )
    fail("MEETING_INVALID_RANGE");
  return {
    title:
      typeof title === "string"
        ? title.replace(/\0/g, "").trim().slice(0, 200)
        : "",
    body:
      typeof body === "string" ? body.replace(/\0/g, "").slice(0, 100_000) : "",
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    ...(recurrence ? { recurrence } : {}),
  };
}
function rawNumber(data: FieldsData, lid: number): number {
  const value: unknown = data.rawProps?.find(
    (p) =>
      p.propertySet?.toLowerCase() === APPOINTMENT_SET &&
      Number.parseInt(p.propertyLid ?? "", 16) === lid,
  )?.value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  if (value instanceof Uint8Array) {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    return value.length >= 4
      ? view.getUint32(0, true)
      : value.length >= 2
        ? view.getUint16(0, true)
        : (value[0] ?? 0);
  }
  return 0;
}
function checkMsgStatus(data: FieldsData) {
  if (
    /cancel/i.test(data.messageClass ?? "") ||
    (rawNumber(data, 0x8217) & 4) !== 0
  )
    fail("MEETING_CANCELLED");
  if (rawNumber(data, 0x8215)) fail("MEETING_ALL_DAY");
}
function transition(year: number, t: TransitionSystemTime): number {
  if (t.year !== 0 && t.year !== year) fail("MEETING_RECURRENCE_UNSUPPORTED");
  if (
    t.month < 1 ||
    t.month > 12 ||
    t.day < 1 ||
    t.day > (t.year ? 31 : 5) ||
    t.hour < 0 ||
    t.hour > 23 ||
    t.minute < 0 ||
    t.minute > 59 ||
    t.dayOfWeek < 0 ||
    t.dayOfWeek > 6
  )
    fail("MEETING_TIMEZONE");
  let day = t.day;
  if (!t.year) {
    day =
      1 +
      ((7 +
        t.dayOfWeek -
        new Date(Date.UTC(year, t.month - 1, 1)).getUTCDay()) %
        7) +
      (t.day - 1) * 7;
    const last = new Date(Date.UTC(year, t.month, 0)).getUTCDate();
    if (day > last) day -= 7;
  }
  return Date.UTC(year, t.month - 1, day, t.hour, t.minute);
}
function windowsZone(tz: TzReg | undefined): Zone {
  if (
    !tz ||
    ![tz.bias, tz.standardBias, tz.daylightBias].every(
      (v) => Number.isInteger(v) && Math.abs(v) <= 1440,
    )
  )
    fail("MEETING_TIMEZONE");
  const standard = -(tz.bias + tz.standardBias),
    daylight = -(tz.bias + tz.daylightBias);
  if (!tz.standardDate.month && !tz.daylightDate.month)
    return { offsetAt: () => standard };
  if (!tz.standardDate.month || !tz.daylightDate.month)
    fail("MEETING_TIMEZONE");
  return {
    offsetAt(instant) {
      const year = new Date(instant).getUTCFullYear();
      const on = transition(year, tz.daylightDate) - standard * MINUTE;
      const off = transition(year, tz.standardDate) - daylight * MINUTE;
      const summer =
        on < off
          ? instant >= on && instant < off
          : instant >= on || instant < off;
      return summer ? daylight : standard;
    },
  };
}
function matchesPattern(
  day: number,
  first: number,
  p: RecurrencePattern,
): boolean {
  const date = new Date(day),
    start = new Date(first);
  if (p.patternType === 0 && p.recurFrequency === 8202)
    return ((day - first) / MINUTE) % p.period === 0;
  if (p.patternType === 1 && p.recurFrequency === 8203) {
    const week = (value: number) =>
      value - ((new Date(value).getUTCDay() - p.firstDOW + 7) % 7) * DAY;
    return (
      ((week(day) - week(first)) / (7 * DAY)) % p.period === 0 &&
      !!((p.patternTypeWeek?.dayOfWeekBits ?? 0) & (1 << date.getUTCDay()))
    );
  }
  const months =
    (date.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    date.getUTCMonth() -
    start.getUTCMonth();
  if (months % p.period) return false;
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  if (p.patternType === 2)
    return date.getUTCDate() === Math.min(p.patternTypeMonth?.day ?? 0, last);
  if (p.patternType === 4) return date.getUTCDate() === last;
  const nth = p.patternTypeMonthNth;
  if (!nth || !(nth.dayOfWeekBits & (1 << date.getUTCDay()))) return false;
  const matchingDays: number[] = [];
  for (let n = 1; n <= last; n++)
    if (
      nth.dayOfWeekBits &
      (1 <<
        new Date(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), n),
        ).getUTCDay())
    )
      matchingDays.push(n);
  return (
    date.getUTCDate() ===
    (nth.n === 5 ? matchingDays.at(-1) : matchingDays[nth.n - 1])
  );
}
function recurringMsg(data: FieldsData, now: number): MeetingInvitation {
  const recur = data.apptRecur!;
  const p = recur.recurrencePattern;
  if (
    ![0, 1, 2].includes(p.calendarType) ||
    ![0, 1, 2, 3, 4].includes(p.patternType) ||
    p.slidingFlag ||
    p.period <= 0 ||
    p.period > 1_438_560 ||
    p.firstDOW > 6
  )
    fail("MEETING_RECURRENCE_UNSUPPORTED");
  if (
    (p.patternType === 0 && (p.recurFrequency !== 8202 || p.period % 1440)) ||
    (p.patternType === 1 && p.recurFrequency !== 8203) ||
    (p.patternType >= 2 && ![8204, 8205].includes(p.recurFrequency))
  )
    fail("MEETING_RECURRENCE_UNSUPPORTED");
  if (recur.exceptionInfo.length > 1000 || p.deletedInstanceDates.length > 1000)
    fail("MEETING_COMPLEXITY");
  const zone = windowsZone(data.timeZoneStruct),
    today = dayOf(wallAt(now, zone));
  const first = fromMinutes(p.startDate);
  const until = [8227, 0xffffffff].includes(p.endType)
    ? today + 3660 * DAY
    : fromMinutes(p.endDate);
  if (!Number.isFinite(first) || first % DAY || today - first > 100 * 366 * DAY)
    fail("MEETING_RECURRENCE_UNSUPPORTED");
  const candidates: { wall: number; endWall: number; title?: string }[] = [];
  const removed = new Set(p.deletedInstanceDates.map(fromMinutes));
  for (const exception of recur.exceptionInfo) {
    removed.add(dayOf(fromMinutes(exception.originalStartTime)));
    if ((exception.meetingType ?? 0) & 4) continue;
    const wall = fromMinutes(exception.startDateTime);
    if (dayOf(wall) >= today) {
      if (exception.subType) fail("MEETING_ALL_DAY");
      candidates.push({
        wall,
        endWall: fromMinutes(exception.endDateTime),
        title: exception.subject,
      });
    }
  }
  let count = 0;
  for (
    let day = first, steps = 0;
    day <= Math.min(until, today + 3660 * DAY);
    day += DAY
  ) {
    if (++steps > 40_000) fail("MEETING_COMPLEXITY");
    if (!matchesPattern(day, first, p)) continue;
    if (p.endType === 8226 && ++count > p.occurrenceCount) break;
    if (day < today || removed.has(day)) continue;
    candidates.push({
      wall: day + recur.startTimeOffset * MINUTE,
      endWall: day + recur.endTimeOffset * MINUTE,
    });
    break;
  }
  candidates.sort((a, b) => a.wall - b.wall);
  const chosen = candidates[0];
  if (!chosen) fail("MEETING_NO_OCCURRENCE");
  if (candidates[1] && dayOf(chosen.wall) === dayOf(candidates[1].wall))
    fail("MEETING_AMBIGUOUS_TIME");
  const start = instantAt(chosen.wall, zone),
    end = instantAt(chosen.endWall, zone);
  const embedded = data.attachments
    ?.map((a) => a.innerMsgContentFields)
    .find((item) => item && Date.parse(item.apptStartWhole ?? "") === start);
  if (embedded) checkMsgStatus(embedded);
  return result(
    chosen.title ?? embedded?.subject ?? data.subject,
    embedded?.body ?? data.body,
    start,
    end,
    dayOf(chosen.wall) === today ? "today" : "next",
  );
}
async function parseMsg(
  bytes: Uint8Array,
  now: number,
): Promise<MeetingInvitation> {
  const signature = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (bytes.length < 512 || signature.some((b, i) => bytes[i] !== b))
    fail("MEETING_INVALID");
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    header.getUint16(28, true) !== 0xfffe ||
    ![9, 12].includes(header.getUint16(30, true)) ||
    header.getUint16(32, true) !== 6
  )
    fail("MEETING_INVALID");
  const module = await import("@kenjiuno/msgreader");
  // CJS has an additional default wrapper under native Node ESM, unlike Vite.
  const exported: unknown = module.default;
  const Reader = (
    typeof exported === "function"
      ? exported
      : (exported as { default: unknown }).default
  ) as new (data: DataView) => {
    parserConfig: { includeRawProps: boolean };
    getFileData(): FieldsData;
  };
  const reader = new Reader(
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  );
  reader.parserConfig = { includeRawProps: true };
  const data = reader.getFileData();
  if (data.error) fail("MEETING_INVALID");
  checkMsgStatus(data);
  if (
    !/^IPM\.(Appointment|Schedule\.Meeting(?:\.Request|\.Resp\.[^.]+)?)$/i.test(
      data.messageClass ?? "",
    )
  )
    fail("MEETING_NO_EVENT");
  if (data.apptRecur) return recurringMsg(data, now);
  if (rawNumber(data, 0x8223)) fail("MEETING_RECURRENCE_UNSUPPORTED");
  return result(
    data.subject,
    data.body,
    Date.parse(data.apptStartWhole ?? ""),
    Date.parse(data.apptEndWhole ?? ""),
  );
}

function ianaZone(id: string): Zone | undefined {
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: id,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    return {
      offsetAt(instant) {
        const p = Object.fromEntries(
          formatter
            .formatToParts(instant)
            .map((part) => [part.type, part.value]),
        );
        return (
          (Date.UTC(
            +p.year,
            +p.month - 1,
            +p.day,
            +p.hour,
            +p.minute,
            +p.second,
          ) -
            Math.floor(instant / 1000) * 1000) /
          MINUTE
        );
      },
    };
  } catch {
    return undefined;
  }
}
function timeWall(time: IcalTime): number {
  if (time.isDate) fail("MEETING_ALL_DAY");
  return Date.UTC(
    time.year,
    time.month - 1,
    time.day,
    time.hour,
    time.minute,
    time.second,
  );
}
async function parseIcs(
  bytes: Uint8Array,
  now: number,
): Promise<MeetingInvitation> {
  const text = new TextDecoder("utf-8", { fatal: true })
    .decode(bytes)
    .replace(/^\uFEFF/, "");
  if (text.length > 2_000_000) fail("MEETING_COMPLEXITY");
  const lines = text.split(/\r?\n/);
  if (lines.length > 20_000 || lines.some((line) => line.length > 200_000))
    fail("MEETING_COMPLEXITY");
  let depth = 0,
    components = 0;
  for (const line of lines) {
    if (/^BEGIN:/i.test(line) && (++depth > 8 || ++components > 1000))
      fail("MEETING_COMPLEXITY");
    if (/^END:/i.test(line) && --depth < 0) fail("MEETING_INVALID");
  }
  if (depth !== 0) fail("MEETING_INVALID");
  const { default: ICAL } = await import("ical.js");
  const calendar = new ICAL.Component(ICAL.parse(text));
  if (calendar.name !== "vcalendar") fail("MEETING_INVALID");
  if (
    String(calendar.getFirstPropertyValue("method")).toUpperCase() === "CANCEL"
  )
    fail("MEETING_CANCELLED");
  const events = calendar.getAllSubcomponents("vevent");
  if (!events.length) fail("MEETING_NO_EVENT");
  const masters = events.filter((event) => !event.hasProperty("recurrence-id"));
  // A separately exported occurrence retains RECURRENCE-ID but supplies its
  // own schedule. Multiple detached occurrences still require a series master.
  const detached = masters.length === 0 && events.length === 1;
  if (masters.length !== 1 && !detached) fail("MEETING_MULTIPLE_EVENTS");
  const master = masters[0] ?? events[0],
    uid = master.getFirstPropertyValue("uid");
  if (
    events.some(
      (event) => event !== master && event.getFirstPropertyValue("uid") !== uid,
    )
  )
    fail("MEETING_MULTIPLE_EVENTS");
  const zones = new Map(
    calendar
      .getAllSubcomponents("vtimezone")
      .map((component) => [
        String(component.getFirstPropertyValue("tzid")),
        new ICAL.Timezone({ component }),
      ]),
  );
  const zoneFor = (
    property: InstanceType<typeof ICAL.Property> | null,
    fallback?: Zone,
  ): Zone => {
    if (!property) return fallback ?? fail("MEETING_NO_TIME");
    const value = property.getFirstValue() as IcalTime;
    if (!value || typeof value !== "object" || !("isDate" in value))
      fail("MEETING_INVALID");
    if (value.isDate) fail("MEETING_ALL_DAY");
    if (value.zone === ICAL.Timezone.utcTimezone) return UTC;
    const id = String(property.getParameter("tzid") ?? "");
    if (!id) fail("MEETING_TIMEZONE");
    const iana = ianaZone(id);
    if (iana) return iana;
    const embedded = zones.get(id);
    if (!embedded) fail("MEETING_TIMEZONE");
    return {
      offsetAt(instant) {
        const utc = ICAL.Time.fromJSDate(new Date(instant), true);
        return utc.convertToZone(embedded).utcOffset() / 60;
      },
    };
  };
  for (const event of events) {
    for (const name of [
      "dtstart",
      "dtend",
      "duration",
      "summary",
      "description",
      "status",
      "recurrence-id",
    ])
      if (event.getAllProperties(name).length > 1) fail("MEETING_INVALID");
    if (
      !event.hasProperty("dtstart") ||
      (!event.hasProperty("dtend") &&
        !event.hasProperty("duration") &&
        event === master)
    )
      fail("MEETING_NO_TIME");
    if (event.hasProperty("dtend") && event.hasProperty("duration"))
      fail("MEETING_INVALID");
    if (event.getFirstProperty("recurrence-id")?.getParameter("range"))
      fail("MEETING_RECURRENCE_UNSUPPORTED");
    for (const name of ["dtstart", "dtend", "recurrence-id"]) {
      const property = event.getFirstProperty(name);
      if (!property) continue;
      const raw = String(property.toJSON()[3]);
      const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z?$/.exec(
        raw,
      );
      if (!match) {
        if (property.type === "date") fail("MEETING_ALL_DAY");
        fail("MEETING_INVALID");
      }
      const nums = match.slice(1).map(Number),
        date = new Date(
          Date.UTC(nums[0], nums[1] - 1, nums[2], nums[3], nums[4], nums[5]),
        );
      if (
        [
          date.getUTCFullYear(),
          date.getUTCMonth() + 1,
          date.getUTCDate(),
          date.getUTCHours(),
          date.getUTCMinutes(),
          date.getUTCSeconds(),
        ].some((n, i) => n !== nums[i])
      )
        fail("MEETING_INVALID");
    }
  }
  if (
    String(master.getFirstPropertyValue("status")).toUpperCase() === "CANCELLED"
  )
    fail("MEETING_CANCELLED");
  const event = new ICAL.Event(master, {
    strictExceptions: true,
    exceptions: events.filter((e) => e !== master),
  });
  if (detached && event.isRecurring()) fail("MEETING_RECURRENCE_UNSUPPORTED");
  const startZone = zoneFor(master.getFirstProperty("dtstart"));
  const getResult = (
    item: InstanceType<typeof ICAL.Event>,
    start: IcalTime,
    end: IcalTime,
    recurrence?: "today" | "next",
  ) => {
    const zone = zoneFor(item.component.getFirstProperty("dtstart"), startZone);
    const startInstant = instantAt(timeWall(start), zone);
    let endInstant: number;
    if (item.component.hasProperty("duration")) {
      const duration = item.duration;
      if (duration.isNegative) fail("MEETING_INVALID_RANGE");
      // RFC5545: days/weeks are nominal calendar units; hours/minutes/seconds are elapsed time.
      const nominalEnd =
        timeWall(start) + (duration.weeks * 7 + duration.days) * DAY;
      endInstant =
        instantAt(nominalEnd, zone) +
        (duration.hours * 3600 + duration.minutes * 60 + duration.seconds) *
          1000;
    } else
      endInstant = instantAt(
        timeWall(end),
        zoneFor(item.component.getFirstProperty("dtend"), zone),
      );
    return result(
      item.summary,
      item.description,
      startInstant,
      endInstant,
      recurrence,
    );
  };
  if (!event.isRecurring())
    return getResult(event, event.startDate, event.endDate);
  const rules = master.getAllProperties("rrule");
  if (
    rules.length > 1 ||
    rules.some(
      (rule) =>
        !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(
          String((rule.getFirstValue() as { freq?: string }).freq),
        ),
    )
  )
    fail("MEETING_RECURRENCE_UNSUPPORTED");
  const today = dayOf(wallAt(now, startZone));
  type Occurrence = {
    item: InstanceType<typeof ICAL.Event>;
    startDate: IcalTime;
    endDate: IcalTime;
  };
  const candidateFor = (occurrence: Occurrence) => {
    const startInstant = instantAt(
      timeWall(occurrence.startDate),
      zoneFor(occurrence.item.component.getFirstProperty("dtstart"), startZone),
    );
    // Exceptions can change timezone as well as date. Compare their instants
    // and calendar days in the series timezone, never their raw local clocks.
    return {
      ...occurrence,
      startInstant,
      seriesDay: dayOf(wallAt(startInstant, startZone)),
    };
  };
  const candidates: ReturnType<typeof candidateFor>[] = [];
  for (const component of events.filter((e) => e !== master)) {
    const item = new ICAL.Event(component);
    if (
      String(component.getFirstPropertyValue("status")).toUpperCase() ===
      "CANCELLED"
    )
      continue;
    const candidate = candidateFor({
      item,
      startDate: item.startDate,
      endDate: item.endDate,
    });
    if (candidate.seriesDay >= today) candidates.push(candidate);
  }
  const iterator = event.iterator();
  for (let count = 0; ; count++) {
    if (count >= 10_000) fail("MEETING_COMPLEXITY");
    const occurrence = iterator.next();
    if (!occurrence) break;
    const detail = event.getOccurrenceDetails(occurrence);
    if (detail.item !== event) continue; // Explicit exceptions were considered above, including moved dates.
    // Unmodified occurrences already use the series clock. Skip past days and
    // stop after the chosen day before resolving irrelevant DST transitions.
    const seriesDay = dayOf(timeWall(detail.startDate));
    if (seriesDay < today) continue;
    if (
      candidates.length &&
      seriesDay > Math.min(...candidates.map((c) => c.seriesDay))
    )
      break;
    candidates.push(candidateFor(detail));
  }
  candidates.sort((a, b) => a.startInstant - b.startInstant);
  const chosen = candidates[0];
  if (!chosen) fail("MEETING_NO_OCCURRENCE");
  if (candidates[1] && chosen.seriesDay === candidates[1].seriesDay)
    fail("MEETING_AMBIGUOUS_TIME");
  return getResult(
    chosen.item,
    chosen.startDate,
    chosen.endDate,
    chosen.seriesDay === today ? "today" : "next",
  );
}

/** Local-only parsing. Untrusted files must run in the cancellable browser worker. */
export async function parseMeetingInvitation(
  name: string,
  bytes: Uint8Array,
  now = Date.now(),
): Promise<MeetingInvitation> {
  if (bytes.byteLength > MAX_MEETING_BYTES) fail("MEETING_FILE_LIMIT");
  if (!bytes.byteLength || !Number.isFinite(now)) fail("MEETING_INVALID");
  const extension = name.toLowerCase().split(".").at(-1);
  if (extension !== "msg" && extension !== "ics") fail("MEETING_FORMAT");
  try {
    return extension === "msg"
      ? await parseMsg(bytes, now)
      : await parseIcs(bytes, now);
  } catch (error) {
    if (error instanceof MeetingInvitationError) throw error;
    throw new MeetingInvitationError("MEETING_INVALID");
  }
}
