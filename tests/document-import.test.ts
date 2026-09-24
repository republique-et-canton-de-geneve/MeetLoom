import test from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { Document, Packer, Paragraph } from "docx";
import PptxGenJS from "pptxgenjs";
import { parseDocument } from "../server/document-parser.js";
import { extractDocument } from "../server/document-extract.js";
import { tableToAgenda, linesToAgenda } from "../shared/document-import.js";
import { mergeImportedAgenda } from "../shared/import-agenda.js";
import { createSession, publicProjection } from "../shared/domain.js";
import { parseDuration } from "../src/time-input.js";

function pdfFixture() {
  const content = "BT /F1 12 Tf 50 750 Td (Agenda original 25 minutes) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}
async function xlsxFixture() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/></Types>',
  );
  zip.file(
    "xl/workbook.xml",
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Programme" sheetId="1" r:id="rId1"/></sheets></workbook>',
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Titre</t></is></c><c r="B1" t="inlineStr"><is><t>Minutes</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Décision</t></is></c><c r="B2"><v>25</v></c></row></sheetData></worksheet>',
  );
  return zip.generateAsync({ type: "nodebuffer" });
}
test("document extraction reads original DOCX, PPTX slide order, XLSX values, PDF text and quoted CSV", async () => {
  const docx = await Packer.toBuffer(
    new Document({
      sections: [
        {
          children: [
            new Paragraph("Accueil confidentiel"),
            new Paragraph("Décision en 25 minutes"),
          ],
        },
      ],
    }),
  );
  assert.match(
    (await parseDocument("atelier.docx", docx)).text,
    /Accueil confidentiel/,
  );
  const slides = new PptxGenJS();
  slides.addSlide().addText("Première étape", { x: 1, y: 1, w: 4, h: 1 });
  slides.addSlide().addText("Deuxième étape", { x: 1, y: 1, w: 4, h: 1 });
  const pptx = (await slides.write({ outputType: "nodebuffer" })) as Buffer;
  const presentation = await parseDocument("atelier.pptx", pptx);
  assert.ok(
    presentation.text.indexOf("Première") <
      presentation.text.indexOf("Deuxième"),
  );
  assert.equal(presentation.tables[0].rows.length, 2);
  const excel = await parseDocument("atelier.xlsx", await xlsxFixture());
  assert.deepEqual(excel.tables[0], {
    name: "Programme",
    rows: [
      ["Titre", "Minutes"],
      ["Décision", "25"],
    ],
  });
  const pdf = await parseDocument("atelier.pdf", pdfFixture());
  assert.match(pdf.text, /Agenda original 25 minutes/);
  const csv = await parseDocument(
    "atelier.csv",
    Buffer.from('Titre;Durée;Notes\r\n"Débat; vote";25;"ligne 1\nligne 2"'),
  );
  assert.deepEqual(csv.tables[0].rows[1], [
    "Débat; vote",
    "25",
    "ligne 1\nligne 2",
  ]);
});
test("untrusted documents reject external entities, archive bombs, unsupported formats, excessive input and worker deadlines", async () => {
  const unsafe = new JSZip();
  unsafe.file(
    "word/document.xml",
    '<!DOCTYPE doc [<!ENTITY evil SYSTEM "file:///secret">]><doc>&evil;</doc>',
  );
  await assert.rejects(
    parseDocument(
      "evil.docx",
      await unsafe.generateAsync({ type: "nodebuffer" }),
    ),
    /IMPORT_XML_UNSAFE/,
  );
  const huge = new JSZip();
  huge.file("word/document.xml", " ".repeat(9_000_000));
  await assert.rejects(
    parseDocument(
      "huge.docx",
      await huge.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }),
    ),
    /IMPORT_ARCHIVE_LIMIT/,
  );
  await assert.rejects(
    parseDocument("binary.exe", Buffer.from("MZ")),
    /IMPORT_FORMAT_UNSUPPORTED/,
  );
  await assert.rejects(
    extractDocument("large.txt", new Uint8Array(5_000_001)),
    (error) => (error as { code: string }).code === "IMPORT_FILE_LIMIT",
  );
  await assert.rejects(
    extractDocument("small.txt", Buffer.from("hello"), 1),
    (error) => (error as { code: string }).code === "IMPORT_TIMEOUT",
  );
  assert.equal(
    (await extractDocument("agenda.txt", Buffer.from("Accueil\nÉchanges")))
      .text,
    "Accueil\nÉchanges",
  );
});
test("table mapping validates durations and merge keeps imported document descriptions and speakers private", () => {
  const incoming = tableToAgenda(
    {
      name: "Programme",
      rows: [
        ["Titre", "Durée", "Notes", "Responsable"],
        ["Ouverture", "1h15", "PROMPTER_SECRET", "PRIVATE_SPEAKER"],
      ],
    },
    {
      title: 0,
      duration: 1,
      description: 2,
      facilitator: 3,
      header: true,
      defaultDuration: 5,
    },
    "fr",
    parseDuration,
  );
  assert.equal(incoming.days[0].blocks[0].duration, 75);
  const destination = createSession("owner", "Destination", "fr", true);
  const before = JSON.stringify(destination);
  const merged = mergeImportedAgenda(destination, incoming);
  assert.equal(
    merged.columns.length,
    destination.columns.length + 2,
    "Only populated private document fields add columns",
  );
  const textOnly = mergeImportedAgenda(
    destination,
    linesToAgenda("Opening\nDiscussion", "Text", "en", 5),
  );
  assert.equal(
    textOnly.columns.length,
    destination.columns.length,
    "Plain text imports must not add blank default columns",
  );
  assert.equal(JSON.stringify(destination), before);
  const projected = JSON.stringify(publicProjection(merged));
  assert.ok(!projected.includes("PROMPTER_SECRET"));
  assert.ok(!projected.includes("PRIVATE_SPEAKER"));
  assert.throws(
    () =>
      tableToAgenda(
        { name: "Bad", rows: [["Debate", "n/a"]] },
        { title: 0, duration: 1, header: false, defaultDuration: 5 },
        "en",
        parseDuration,
      ),
    /IMPORT_DURATION:1/,
  );
  assert.equal(
    linesToAgenda("One\n\nTwo", "Lines", "en", 5).days[0].blocks.length,
    2,
  );
});
