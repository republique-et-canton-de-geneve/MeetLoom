import { formatTime, plannedStartTimestamp } from "./domain.js";
import type { AccountPreferences } from "./accounts.js";

export function displayTime(
  minutes: number,
  date: string,
  sourceZone: string,
  preferences: Pick<AccountPreferences, "displayTimezone" | "hour12">,
  locale = "fr",
): string {
  const zone = preferences.displayTimezone || sourceZone;
  if (zone === sourceZone && !preferences.hour12) return formatTime(minutes);
  try {
    // Resolve each wall time, including DST boundaries and blocks beyond midnight.
    const effectiveDate = new Date(
      Date.parse(`${date}T00:00:00Z`) + Math.floor(minutes / 1440) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    const timestamp = plannedStartTimestamp(
      {
        timezone: sourceZone,
        days: [
          {
            id: "display",
            title: "",
            date: effectiveDate,
            startTime: formatTime(minutes),
            blocks: [
              {
                id: "time",
                title: "",
                duration: 0,
                description: "",
                facilitator: "",
                fields: {},
                category: "discussion",
                section: "",
                lockedStart: undefined,
              },
            ],
          },
        ],
      },
      "display",
    );
    const display = new Intl.DateTimeFormat(
      locale === "fr" ? "fr-CH" : "en-GB",
      {
        timeZone: zone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: preferences.hour12,
      },
    ).format(timestamp);
    const localDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(timestamp);
    return display + (localDate !== date ? ` (${localDate})` : "");
  } catch {
    return "—";
  }
}
