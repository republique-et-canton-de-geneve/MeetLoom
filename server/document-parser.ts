import path from "node:path";
import { createRequire } from "node:module";
import JSZip from "jszip";
import { SaxesParser } from "saxes";
import { parse } from "csv-parse/sync";
import mammoth from "mammoth";
import readXlsxFile from "read-excel-file/node";
import {
  DOCUMENT_MAX_BYTES,
  DOCUMENT_MAX_TEXT,
  type ExtractedDocument,
} from "../shared/document-import.js";

function fail(code: string): never {
  throw new Error(code);
}
const limitText = (text: string) =>
  text.length > DOCUMENT_MAX_TEXT
    ? fail("IMPORT_TEXT_LIMIT")
    : text.replace(/\u0000/g, "").trim();
function xml(
  source: string,
  onOpen?: (name: string, attributes: Record<string, string>) => void,
  onText?: (text: string) => void,
  onClose?: (name: string) => void,
) {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) fail("IMPORT_XML_UNSAFE");
  const parser = new SaxesParser({ xmlns: false });
  let depth = 0,
    nodes = 0;
  parser.on("opentag", (tag) => {
    if (++depth > 100 || ++nodes > 300_000) fail("IMPORT_XML_LIMIT");
    onOpen?.(tag.name, tag.attributes as Record<string, string>);
  });
  parser.on("text", (text) => onText?.(text));
  parser.on("cdata", (text) => onText?.(text));
  parser.on("closetag", (tag) => {
    onClose?.(tag.name);
    depth--;
  });
  parser.on("error", () => fail("IMPORT_FILE_INVALID"));
  parser.write(source).close();
}
async function safeZip(bytes: Buffer) {
  const zip = await JSZip.loadAsync(bytes, {
    checkCRC32: false,
    createFolders: false,
  });
  const entries = Object.values(zip.files);
  if (entries.length > 1500) fail("IMPORT_ARCHIVE_LIMIT");
  let total = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    let size = 0;
    const xmlFile = /\.(xml|rels)$/i.test(entry.name);
    const parts: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = entry.nodeStream("nodebuffer");
      stream.on("error", reject);
      stream.on("end", resolve);
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        total += chunk.length;
        if (size > 8_000_000 || total > 25_000_000) {
          stream.pause();
          reject(new Error("IMPORT_ARCHIVE_LIMIT"));
          return;
        }
        if (xmlFile)
          parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
    });
    if (xmlFile) xml(Buffer.concat(parts).toString("utf8"));
  }
  return zip;
}
function normalizeRows(rows: unknown[][]): string[][] {
  if (
    rows.length > 1001 ||
    rows.some((row) => row.length > 40) ||
    rows.reduce((sum, row) => sum + row.length, 0) > 40000
  )
    fail("IMPORT_TABLE_LIMIT");
  const result = rows.map((row) =>
    row.map((cell) =>
      cell === null || cell === undefined
        ? ""
        : cell instanceof Date
          ? cell.toISOString()
          : String(cell),
    ),
  );
  if (result.some((row) => row.some((cell) => cell.length > 30000)))
    fail("IMPORT_TEXT_LIMIT");
  limitText(result.flat().join("\n"));
  return result;
}
function decode(bytes: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  } catch {
    return fail("IMPORT_ENCODING");
  }
}
export async function parseDocument(
  name: string,
  input: Uint8Array,
): Promise<ExtractedDocument> {
  const bytes = Buffer.from(input);
  if (bytes.length > DOCUMENT_MAX_BYTES) fail("IMPORT_FILE_LIMIT");
  if (!bytes.length) fail("IMPORT_EMPTY");
  const extension = name.toLowerCase().split(".").pop();
  const result: ExtractedDocument = {
    name,
    kind: "text",
    text: "",
    tables: [],
    warnings: [],
  };
  if (["txt", "md", "markdown", "csv", "tsv"].includes(extension ?? "")) {
    result.text = limitText(decode(bytes));
    if (extension === "csv" || extension === "tsv") {
      result.kind = "csv";
      const possibilities = (extension === "tsv" ? ["\t"] : [",", ";", "\t"])
        .flatMap((delimiter) => {
          try {
            return [
              parse(result.text, {
                delimiter,
                bom: true,
                skip_empty_lines: true,
                max_record_size: 100_000,
                relax_column_count: true,
              }) as string[][],
            ];
          } catch {
            return [];
          }
        })
        .filter((rows) => rows.length > 0);
      const rows = possibilities.sort(
        (a, b) =>
          Math.max(...b.slice(0, 10).map((row) => row.length)) -
          Math.max(...a.slice(0, 10).map((row) => row.length)),
      )[0];
      if (!rows) fail("IMPORT_FILE_INVALID");
      result.tables = [{ name, rows: normalizeRows(rows) }];
    }
  } else if (["docx", "pptx", "xlsx"].includes(extension ?? "")) {
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail("IMPORT_FILE_INVALID");
    const zip = await safeZip(bytes);
    if (extension === "docx") {
      if (!zip.file("word/document.xml")) fail("IMPORT_FILE_INVALID");
      result.kind = "docx";
      const extracted = await mammoth.extractRawText({ buffer: bytes });
      result.text = limitText(extracted.value);
      if (extracted.messages.length)
        result.warnings.push("IMPORT_FORMATTING_OMITTED");
    } else if (extension === "xlsx") {
      if (!zip.file("xl/workbook.xml")) fail("IMPORT_FILE_INVALID");
      result.kind = "xlsx";
      const sheets = await readXlsxFile(bytes);
      if (sheets.length > 30) fail("IMPORT_TABLE_LIMIT");
      result.tables = sheets.map((sheet) => ({
        name: sheet.sheet,
        rows: normalizeRows(sheet.data),
      }));
      result.text = limitText(
        result.tables
          .map(
            (table) =>
              `${table.name}\n${table.rows.map((row) => row.join("\t")).join("\n")}`,
          )
          .join("\n\n"),
      );
      result.warnings.push("IMPORT_FORMULAS_CACHED");
    } else {
      result.kind = "pptx";
      const presentation = zip.file("ppt/presentation.xml"),
        relations = zip.file("ppt/_rels/presentation.xml.rels");
      if (!presentation || !relations) fail("IMPORT_FILE_INVALID");
      const ids: string[] = [],
        targets = new Map<string, string>();
      xml(await presentation.async("string"), (tag, attrs) => {
        if (tag.split(":").at(-1) === "sldId") ids.push(attrs["r:id"]);
      });
      xml(await relations.async("string"), (tag, attrs) => {
        if (
          tag.split(":").at(-1) === "Relationship" &&
          attrs.TargetMode !== "External"
        )
          targets.set(attrs.Id, attrs.Target);
      });
      if (ids.length > 500) fail("IMPORT_PAGE_LIMIT");
      const slides: string[] = [];
      for (const id of ids) {
        const target = targets.get(id);
        if (!target) continue;
        const normalized = path.posix.normalize(
          target.startsWith("/") ? target.slice(1) : `ppt/${target}`,
        );
        if (!normalized.startsWith("ppt/slides/")) fail("IMPORT_FILE_INVALID");
        const slide = zip.file(normalized);
        if (!slide) fail("IMPORT_FILE_INVALID");
        let text = "",
          inside = false;
        xml(
          await slide.async("string"),
          (tag) => {
            if (tag === "a:t") inside = true;
          },
          (part) => {
            if (inside) text += part;
          },
          (tag) => {
            if (tag === "a:t") inside = false;
            if (tag === "a:p") text += "\n";
          },
        );
        slides.push(text.trim());
      }
      result.text = limitText(slides.join("\n\n"));
      result.tables = [
        {
          name,
          rows: slides
            .filter(Boolean)
            .map((text) => [
              text.split("\n")[0],
              text.split("\n").slice(1).join("\n"),
            ]),
        },
      ];
      result.warnings.push("IMPORT_FORMATTING_OMITTED");
    }
  } else if (extension === "pdf") {
    if (bytes.subarray(0, 5).toString() !== "%PDF-")
      fail("IMPORT_FILE_INVALID");
    result.kind = "pdf";
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loading = getDocument({
      data: new Uint8Array(bytes),
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      enableXfa: false,
      standardFontDataUrl:
        path
          .join(
            path.dirname(
              createRequire(import.meta.url).resolve("pdfjs-dist/package.json"),
            ),
            "standard_fonts",
          )
          .replaceAll("\\", "/") + "/",
      stopAtErrors: true,
    });
    const pdf = await loading.promise;
    try {
      if (pdf.numPages > 100) fail("IMPORT_PAGE_LIMIT");
      const pages: string[] = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber),
          content = await page.getTextContent();
        pages.push(
          content.items
            .map((item) =>
              "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "",
            )
            .join(""),
        );
        limitText(pages.join("\n"));
        page.cleanup();
      }
      result.text = limitText(pages.join("\n\n"));
      if (!result.text) result.warnings.push("IMPORT_SCAN_NO_TEXT");
    } finally {
      await loading.destroy();
    }
  } else fail("IMPORT_FORMAT_UNSUPPORTED");
  return result;
}
