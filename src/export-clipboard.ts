import type { Locale, PublicSession } from "../shared/model";
import { formatTime } from "../shared/domain";
import { scheduleExportDay } from "../shared/export-projection";
import { richTextToPlain } from "../shared/richtext";
import { columnValue } from "./export";
export function clipboardTable(session: PublicSession, locale: Locale) {
  const rows: string[][] = [
    [
      locale === "fr" ? "Jour" : "Day",
      locale === "fr" ? "Horaire" : "Time",
      locale === "fr" ? "Activité" : "Activity",
      ...session.columns.map((column) => column.label),
    ],
  ];
  for (const day of session.days)
    for (const row of scheduleExportDay(session, day))
      rows.push([
        day.title,
        `${formatTime(row.startMinute)}–${formatTime(row.endMinute)}`,
        row.block.title,
        ...session.columns.map((column) =>
          richTextToPlain(columnValue(row.block, column.id)),
        ),
      ]);
  const safe = (value: string) =>
    /^(?:\s*[=+@-]|[\t\r\n])/u.test(value) ? `'${value}` : value;
  const escape = (value: string) =>
    value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  return {
    text: rows
      .map((row) =>
        row.map((value) => safe(value).replace(/[\t\r\n]+/g, " ")).join("\t"),
      )
      .join("\n"),
    html: `<table><tbody>${rows.map((row, index) => `<tr>${row.map((value) => `<${index ? "td" : "th"}>${escape(safe(value)).replace(/\r?\n/g, "<br>")}</${index ? "td" : "th"}>`).join("")}</tr>`).join("")}</tbody></table>`,
  };
}
export async function copyExportTable(session: PublicSession, locale: Locale) {
  const value = clipboardTable(session, locale);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([value.html], { type: "text/html" }),
        "text/plain": new Blob([value.text], { type: "text/plain" }),
      }),
    ]);
  } else await navigator.clipboard.writeText(value.text);
}
