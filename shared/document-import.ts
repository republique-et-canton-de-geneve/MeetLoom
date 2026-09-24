import type { Locale, Session } from "./model.js";
import { createSession, newBlock } from "./domain.js";
import { sessionInputSchema } from "./validation.js";

export const DOCUMENT_MAX_BYTES = 5_000_000;
export const DOCUMENT_MAX_TEXT = 200_000;
export interface ImportedTable {
  name: string;
  rows: string[][];
}
export interface ExtractedDocument {
  name: string;
  kind: "text" | "csv" | "docx" | "pptx" | "xlsx" | "pdf" | "image";
  text: string;
  tables: ImportedTable[];
  warnings: string[];
}
export interface TableMapping {
  title: number;
  duration?: number;
  description?: number;
  facilitator?: number;
  section?: number;
  header: boolean;
  defaultDuration: number;
}
/** Imports always start private; mergeImportedAgenda preserves that audience. */
export function importedAgenda(title: string, locale: Locale): Session {
  const session = createSession(
    "document-import",
    title.slice(0, 200) || "Import",
    locale,
  );
  // A parsed document has no custom-column schema. Do not import the blank
  // defaults of a new session on every CSV/text upload.
  session.columns = session.columns
    .filter(
      (column) => column.id === "description" || column.id === "facilitator",
    )
    .map((column) => ({
      ...column,
      visibility: "team",
    }));
  session.days[0].blocks = [];
  return session;
}
export function tableToAgenda(
  table: ImportedTable,
  mapping: TableMapping,
  locale: Locale,
  parseDuration: (value: string) => number | null,
): Session {
  if (
    !Number.isFinite(mapping.defaultDuration) ||
    mapping.defaultDuration < 0 ||
    mapping.defaultDuration > 1440
  )
    throw new Error("IMPORT_DURATION");
  const session = importedAgenda(table.name, locale);
  const rows = mapping.header ? table.rows.slice(1) : table.rows;
  session.days[0].blocks = rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row, index) => {
      const value = (key: keyof TableMapping) =>
        typeof mapping[key] === "number" && key !== "defaultDuration"
          ? (row[mapping[key] as number] ?? "")
          : "";
      const durationText = value("duration").trim();
      const duration = durationText
        ? parseDuration(durationText)
        : mapping.defaultDuration;
      if (duration === null)
        throw new Error(`IMPORT_DURATION:${index + (mapping.header ? 2 : 1)}`);
      const title = value("title").trim();
      if (!title)
        throw new Error(`IMPORT_TITLE:${index + (mapping.header ? 2 : 1)}`);
      return newBlock(locale, {
        title,
        duration,
        description: value("description"),
        facilitator: value("facilitator"),
        section: value("section"),
      });
    });
  if (!session.days[0].blocks.length) throw new Error("IMPORT_EMPTY");
  return sessionInputSchema.parse(session);
}
export function linesToAgenda(
  text: string,
  title: string,
  locale: Locale,
  duration: number,
): Session {
  return tableToAgenda(
    {
      name: title,
      rows: text
        .split(/\r?\n/)
        .map((line) => [line.trim()])
        .filter((row) => row[0]),
    },
    { title: 0, header: false, defaultDuration: duration },
    locale,
    () => null,
  );
}
