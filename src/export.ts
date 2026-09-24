import {
  blockDuration,
  formatTime,
  publicProjection,
  scheduleTreeDay,
} from "../shared/domain.js";
import { richTextToPlain } from "../shared/richtext.js";
import { scheduleExportDay } from "../shared/export-projection.js";
import type {
  Locale,
  PublicBlock,
  PublicSession,
  Session,
} from "../shared/model.js";

/** Quoting alone does not prevent spreadsheet programs from executing formulas. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^(?:\s*[=+@-]|[\t\r\n])/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function columnValue(block: PublicBlock, columnId: string): string {
  if (columnId === "description") return block.description ?? "";
  if (columnId === "facilitator") return block.facilitator ?? "";
  return Object.hasOwn(block.fields, columnId) ? block.fields[columnId] : "";
}

/** Returns a UTF-8 BOM CSV. Authenticated exports include team columns; public ones never do. */
export function exportSessionCsv(
  session: Session | PublicSession,
  locale: Locale = "fr",
): string {
  const source = "ownerId" in session ? session : publicProjection(session);
  const headers =
    locale === "fr"
      ? [
          "Jour",
          "Date",
          "Début",
          "Fin",
          "Durée (min)",
          "Section",
          "Salle",
          "Activité",
          "Catégorie",
        ]
      : [
          "Day",
          "Date",
          "Start",
          "End",
          "Duration (min)",
          "Section",
          "Room",
          "Activity",
          "Category",
        ];
  const rows: Array<Array<string | number>> = [
    [...headers, ...source.columns.map((column) => column.label)],
  ];
  for (const day of source.days) {
    for (const item of scheduleExportDay(session, day)) {
      rows.push([
        day.title,
        day.date,
        formatTime(item.startMinute),
        formatTime(item.endMinute),
        blockDuration(item.block),
        item.block.section,
        item.roomPath.join(" / "),
        item.block.title,
        source.categories?.find(
          (category) => category.id === item.block.category,
        )?.label ?? item.block.category,
        ...source.columns.map((column) =>
          richTextToPlain(columnValue(item.block, column.id)),
        ),
      ]);
    }
  }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export function exportSessionJson(session: Session | PublicSession): string {
  return JSON.stringify(
    "ownerId" in session ? session : publicProjection(session),
    null,
    2,
  );
}
