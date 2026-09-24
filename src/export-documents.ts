import type { Locale, PublicSession, Session } from "../shared/model";
import {
  allBlocks,
  formatTime,
  publicProjection,
  scheduleTreeDay,
} from "../shared/domain";
import {
  extractMaterials,
  richTextDocument,
  richTextToPlain,
  type RichNode,
} from "../shared/richtext";
import { columnValue } from "./export";
import { DEFAULT_PRINT_OPTIONS, type PrintOptions } from "./export-options";
import { categoriesFor } from "./categories";

import {
  exportProjection,
  exportMaterials,
  defaultSlideOutline,
  scheduleExportDay,
  type ExportOptions,
  type ExportSlide,
} from "../shared/export-projection";
export {
  exportProjection,
  exportMaterials,
  defaultSlideOutline,
  type ExportOptions,
  type ExportSlide,
} from "../shared/export-projection";
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function documentFilename(title: string, extension: string) {
  return `${
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .slice(0, 100)
      .trim() || "meetloom"
  }.${extension}`;
}

export async function wordBlob(
  session: PublicSession,
  locale: Locale,
  options: Pick<ExportOptions, "landscape" | "audience"> &
    Partial<PrintOptions>,
): Promise<Blob> {
  const settings = { ...DEFAULT_PRINT_OPTIONS, ...options };
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    PageOrientation,
    ExternalHyperlink,
    Table,
    TableRow,
    TableCell,
    WidthType,
  } = await import("docx");
  const fr = locale === "fr";
  const richParagraphs = (value: string) => {
    const result: InstanceType<typeof Paragraph>[] = [];
    const inline = (
      node: RichNode,
    ): Array<
      InstanceType<typeof TextRun> | InstanceType<typeof ExternalHyperlink>
    > => {
      if (node.type === "hardBreak") return [new TextRun({ break: 1 })];
      if (node.type === "mention")
        return [new TextRun(`@${String(node.attrs?.label ?? "")}`)];
      if (node.type !== "text") return (node.content ?? []).flatMap(inline);
      const marks = node.marks ?? [];
      const color = marks
        .find((mark) => mark.type === "textStyle")
        ?.attrs?.color?.slice(1);
      const highlight = marks
        .find((mark) => mark.type === "highlight")
        ?.attrs?.color?.slice(1);
      const run = new TextRun({
        text: node.text ?? "",
        bold: marks.some((m) => m.type === "bold"),
        italics: marks.some((m) => m.type === "italic"),
        strike: marks.some((m) => m.type === "strike"),
        underline: marks.some((m) => m.type === "underline") ? {} : undefined,
        color,
        shading: highlight ? { fill: highlight } : undefined,
      });
      const href = marks.find((mark) => mark.type === "link")?.attrs?.href;
      return [
        href ? new ExternalHyperlink({ link: href, children: [run] }) : run,
      ];
    };
    const walk = (node: RichNode, prefix = "", depth = 0) => {
      if (["paragraph", "heading", "codeBlock"].includes(node.type)) {
        result.push(
          new Paragraph({
            children: [
              ...(prefix ? [new TextRun(prefix)] : []),
              ...inline(node),
            ],
            spacing: { after: 90 },
            indent: depth ? { left: Math.min(depth, 5) * 280 } : undefined,
            heading:
              node.type === "heading" ? HeadingLevel.HEADING_3 : undefined,
          }),
        );
      } else if (
        ["bulletList", "orderedList", "taskList"].includes(node.type)
      ) {
        (node.content ?? []).forEach((child, index) => {
          const marker =
            node.type === "orderedList"
              ? `${Number(node.attrs?.start ?? 1) + index}. `
              : node.type === "taskList"
                ? child.attrs?.checked
                  ? "☑ "
                  : "☐ "
                : "• ";
          (child.content ?? []).forEach((part, i) =>
            walk(part, i === 0 ? marker : "", depth + 1),
          );
        });
      } else
        (node.content ?? []).forEach((child) => walk(child, prefix, depth));
    };
    walk(richTextDocument(value));
    return result;
  };
  const children: Array<
    InstanceType<typeof Paragraph> | InstanceType<typeof Table>
  > = [
    new Paragraph({ text: session.title, heading: HeadingLevel.TITLE }),
    new Paragraph({
      text:
        options.audience === "team"
          ? fr
            ? "Document d’équipe — diffusion interne"
            : "Team document — internal distribution"
          : fr
            ? "Agenda destiné aux participants"
            : "Participant agenda",
      spacing: { after: 240 },
    }),
    ...richParagraphs(session.description),
  ];
  if (settings.categoryLegend)
    children.push(
      new Paragraph({
        text: categoriesFor(locale, session.categories)
          .filter((category) =>
            session.days.some((day) =>
              allBlocks(day.blocks).some(
                (block) => block.category === category.id,
              ),
            ),
          )
          .map((category) => category.label)
          .join(" · "),
        spacing: { after: 180 },
      }),
    );
  for (const [index, day] of session.days.entries()) {
    children.push(
      new Paragraph({
        text: `${day.title} · ${day.date}`,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: index > 0 && settings.dayPageBreak,
      }),
    );
    if (settings.layout === "table") {
      const cell = (text: string) =>
        new TableCell({ children: [new Paragraph(text)] });
      const rows = scheduleExportDay(session, day),
        size = settings.blocksPerPage || rows.length || 1;
      for (let offset = 0; offset < rows.length; offset += size) {
        if (offset)
          children.push(
            new Paragraph({ text: day.title, pageBreakBefore: true }),
          );
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                tableHeader: true,
                children: [
                  cell(fr ? "Horaire" : "Time"),
                  cell(fr ? "Activité" : "Activity"),
                  ...session.columns.map((column) => cell(column.label)),
                ],
              }),
              ...rows.slice(offset, offset + size).map(
                (item) =>
                  new TableRow({
                    children: [
                      cell(
                        `${formatTime(item.startMinute)}–${formatTime(item.endMinute)}`,
                      ),
                      cell(
                        `${item.roomPath.join(" / ")}${item.roomPath.length ? " · " : ""}${item.block.title}`,
                      ),
                      ...session.columns.map(
                        (column) =>
                          new TableCell({
                            children: richParagraphs(
                              columnValue(item.block, column.id),
                            ),
                          }),
                      ),
                    ],
                  }),
              ),
            ],
          }),
        );
      }
      continue;
    }
    for (const [rowIndex, item] of scheduleExportDay(session, day).entries()) {
      children.push(
        new Paragraph({
          text:
            settings.layout === "details"
              ? item.block.title
              : `${formatTime(item.startMinute)} – ${formatTime(item.endMinute)}  ${item.block.title}`,
          heading: HeadingLevel.HEADING_2,
          keepNext: true,
          pageBreakBefore:
            settings.blocksPerPage > 0 &&
            rowIndex > 0 &&
            rowIndex % settings.blocksPerPage === 0,
        }),
      );
      for (const column of ["overview", "multiday"].includes(settings.layout)
        ? []
        : session.columns) {
        const value = columnValue(item.block, column.id);
        if (!value.trim()) continue;
        children.push(
          new Paragraph({
            children: [new TextRun({ text: column.label, bold: true })],
            keepNext: true,
          }),
        );
        children.push(...richParagraphs(value));
      }
    }
  }
  for (const page of session.pages ?? []) {
    children.push(
      new Paragraph({
        text: page.title,
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: settings.dayPageBreak,
      }),
    );
    for (const section of page.sections)
      children.push(...richParagraphs(section.content));
  }
  if (settings.includeMaterials) {
    children.push(
      new Paragraph({
        text: fr ? "Matériel à préparer" : "Materials to prepare",
        heading: HeadingLevel.HEADING_1,
      }),
    );
    for (const item of exportMaterials(session))
      children.push(
        new Paragraph(`☐ ${item.text} · ${item.day} / ${item.block}`),
      );
  }
  return Packer.toBlob(
    new Document({
      creator: "MeetLoom",
      title: session.title,
      description: fr ? "Agenda de séance" : "Session agenda",
      styles: {
        default: {
          document: {
            run: { font: settings.font, size: settings.fontSize * 2 },
            paragraph: {
              spacing: { after: settings.layout === "compact" ? 50 : 120 },
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              size: {
                width: settings.paper === "A4" ? 11906 : 12240,
                height:
                  settings.paper === "Legal"
                    ? 20160
                    : settings.paper === "Letter"
                      ? 15840
                      : 16838,
                orientation: settings.landscape
                  ? PageOrientation.LANDSCAPE
                  : PageOrientation.PORTRAIT,
              },
              margin: { top: 850, bottom: 850, left: 850, right: 850 },
            },
          },
          children,
        },
      ],
    }),
  );
}

/** Bound content per slide; long fields continue on another slide instead of being lost. */
export function slideChunks(text: string, limit = 700): string[] {
  const words = text.split(/(\s+)/u);
  const result: string[] = [];
  let current = "";
  for (let word of words) {
    while (word.length > limit) {
      if (current.trim()) {
        result.push(current.trim());
        current = "";
      }
      result.push(word.slice(0, limit));
      word = word.slice(limit);
    }
    if (current.length + word.length > limit) {
      if (current.trim()) result.push(current.trim());
      current = "";
    }
    current += word;
  }
  if (current.trim()) result.push(current.trim());
  return result.length ? result : [""];
}

export async function powerpointBlob(
  session: PublicSession,
  locale: Locale,
  audience: ExportOptions["audience"],
  options: Partial<PrintOptions> & {
    outline?: ExportSlide[];
    speakerNotes?: boolean;
    noteColumnIds?: string[];
  } = {},
): Promise<Blob> {
  const { default: PptxGenJS } = await import("pptxgenjs"),
    settings = { ...DEFAULT_PRINT_OPTIONS, ...options },
    fr = locale === "fr";
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.author = "MeetLoom";
  deck.title = session.title;
  deck.subject = "Session agenda";
  deck.theme = { headFontFace: settings.font, bodyFontFace: settings.font };
  const footer =
    audience === "team"
      ? fr
        ? "DOCUMENT D’ÉQUIPE · INTERNE"
        : "TEAM DOCUMENT · INTERNAL"
      : "MEETLOOM";
  const slide = (title: string, body: string, meta: string, notes?: string) => {
    const page = deck.addSlide();
    page.background = { color: "F6F8FA" };
    page.addText(meta, {
      x: 0.65,
      y: 0.35,
      w: 12,
      h: 0.3,
      fontSize: 12,
      color: "4C676A",
      margin: 0,
    });
    page.addText(title, {
      x: 0.65,
      y: 0.95,
      w: 12,
      h: 1.2,
      fontSize: 28,
      bold: true,
      color: "213C45",
      margin: 0,
      fit: "shrink",
    });
    if (body)
      page.addText(body, {
        x: 0.65,
        y: 2.25,
        w: 12,
        h: 4.45,
        fontSize: 21,
        color: "34454C",
        margin: 0,
        valign: "top",
        fit: "shrink",
      });
    page.addText(footer, {
      x: 0.65,
      y: 7.02,
      w: 11,
      h: 0.2,
      fontSize: 9,
      color: "667981",
      margin: 0,
    });
    page.slideNumber = {
      x: 12,
      y: 7,
      w: 0.5,
      h: 0.25,
      fontSize: 10,
      color: "667981",
    };
    if (notes) page.addNotes(notes);
    return page;
  };
  const paginated = (
    title: string,
    text: string,
    meta: string,
    notes?: string,
  ) => {
    for (const [index, chunk] of slideChunks(text).entries())
      slide(
        `${title}${index ? ` (${index + 1})` : ""}`,
        chunk,
        meta,
        index === 0 ? notes : undefined,
      );
  };
  for (const item of options.outline ?? defaultSlideOutline(session, locale)) {
    if (!item.enabled) continue;
    if (item.kind === "title")
      paginated(
        item.title,
        richTextToPlain(session.description),
        fr ? "AGENDA DE LA SÉANCE" : "SESSION AGENDA",
      );
    if (item.kind === "agenda") {
      const day = session.days.find((day) => day.id === item.targetId);
      if (!day) continue;
      paginated(
        item.title,
        scheduleExportDay(session, day)
          .map(
            (row) =>
              `${formatTime(row.startMinute)}–${formatTime(row.endMinute)}  ${"  ".repeat(row.depth)}${row.block.title}${row.roomPath.length ? ` · ${row.roomPath.join(" / ")}` : ""}`,
          )
          .join("\n"),
        day.date,
      );
    }
    if (item.kind === "block") {
      const day = session.days.find((day) =>
        allBlocks(day.blocks).some((block) => block.id === item.targetId),
      );
      if (!day) continue;
      const row = scheduleExportDay(session, day).find(
        (row) => row.block.id === item.targetId,
      )!;
      const asNotes = (id: string) =>
        !!options.speakerNotes &&
        (!options.noteColumnIds || options.noteColumnIds.includes(id));
      const fieldText = (notes: boolean) =>
        session.columns
          .filter((column) => asNotes(column.id) === notes)
          .map((column) => {
            const value = richTextToPlain(columnValue(row.block, column.id));
            return value.trim() ? `${column.label}\n${value}` : "";
          })
          .filter(Boolean)
          .join("\n\n");
      paginated(
        item.title,
        fieldText(false),
        `${day.title} · ${day.date} · ${formatTime(row.startMinute)}–${formatTime(row.endMinute)}`,
        fieldText(true),
      );
    }
    if (item.kind === "page") {
      const page = session.pages?.find((page) => page.id === item.targetId);
      if (page)
        paginated(
          item.title,
          page.sections
            .map((section) => richTextToPlain(section.content))
            .join("\n\n"),
          fr ? "INFORMATIONS" : "INFORMATION",
        );
    }
    if (item.kind === "form" && item.url) {
      const url = new URL(item.url);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new Error("INVALID_FORM_LINK");
      const { toDataURL } = await import("qrcode");
      const qr = await toDataURL(url.href, { width: 500, margin: 2 });
      const page = slide(
        item.title,
        "",
        fr ? "SCANNEZ POUR RÉPONDRE" : "SCAN TO RESPOND",
      );
      page.addImage({ data: qr, x: 5.05, y: 2.5, w: 3.2, h: 3.2 });
      page.addText(url.href, {
        x: 0.65,
        y: 6.15,
        w: 12,
        h: 0.5,
        fontSize: 12,
        color: "34454C",
        hyperlink: { url: url.href },
        fit: "shrink",
        align: "center",
      });
    }
  }
  if (settings.includeMaterials)
    paginated(
      fr ? "Matériel à préparer" : "Materials to prepare",
      exportMaterials(session)
        .map((item) => `☐ ${item.text} · ${item.block}`)
        .join("\n"),
      "MEETLOOM",
    );
  const buffer = (await deck.write({
    outputType: "arraybuffer",
    compression: true,
  })) as ArrayBuffer;
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}
