/** User-facing time formats, independent of the browser's locale-specific time control. */
export function parseDuration(input: string): number | null {
  const value = input.trim().toLowerCase().replace(/,/g, ".");
  let minutes: number;
  if (/^\d+(?:\.\d+)?\s*(?:m|min|minutes?)?$/.test(value)) {
    minutes = Number.parseFloat(value);
  } else {
    const clock = value.match(/^(\d{1,2})[:h]\s*(\d{1,2})\s*(?:m|min)?$/);
    const hours = value.match(/^(\d+(?:\.\d+)?)\s*(?:h|hours?|heures?)$/);
    const seconds = value.match(/^(\d+)\s*(?:s|sec|seconds?|secondes?)$/);
    if (clock && Number(clock[2]) < 60)
      minutes = Number(clock[1]) * 60 + Number(clock[2]);
    else if (hours) minutes = Number(hours[1]) * 60;
    else if (seconds) minutes = Number(seconds[1]) / 60;
    else return null;
  }
  return Number.isFinite(minutes) && minutes >= 0 && minutes <= 1440
    ? Math.round(minutes * 1000) / 1000
    : null;
}

export function parseClock(input: string): string | null {
  const value = input.trim().toLowerCase();
  const match =
    value.match(/^(\d{1,2})(?:[:h](\d{1,2}))?$/) ??
    value.match(/^(\d{1,2})(\d{2})$/);
  if (!match) return null;
  const hours = Number(match[1]),
    minutes = Number(match[2] ?? 0);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function shiftClock(value: string, minutes: number): string {
  const [hour, minute] = value.split(":").map(Number);
  const total = (((hour * 60 + minute + minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
