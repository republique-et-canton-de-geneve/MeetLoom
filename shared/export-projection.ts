import type {
  Locale,
  PublicSession,
  PublicDay,
  PublicBlock,
  Session,
} from "./model.js";
import { allBlocks, publicProjection, scheduleTreeDay } from "./domain.js";
import { extractMaterials } from "./richtext.js";
function columnValue(block: PublicBlock, id: string) {
  return id === "description"
    ? (block.description ?? "")
    : id === "facilitator"
      ? (block.facilitator ?? "")
      : (block.fields[id] ?? "");
}
export interface ExportOptions {
  audience: "team" | "public";
  dayIds: string[];
  columnIds: string[];
  landscape: boolean;
  pageIds?: string[];
  blockIds?: string[];
  categoryIds?: string[];
}
export interface ExportSession extends PublicSession {
  exportTimings?: Record<string, { startMinute: number; endMinute: number }>;
}
export function scheduleExportDay(session: PublicSession, day: PublicDay) {
  const timings = (session as ExportSession).exportTimings;
  return scheduleTreeDay(day).map((row) => ({
    ...row,
    ...timings?.[row.block.id],
  }));
}

/** Every output receives only selected data. Public selection can never elevate a team field. */
export function exportProjection(
  session: Session,
  options: ExportOptions,
): ExportSession {
  const permitted =
    options.audience === "public" ? publicProjection(session) : session;
  const filter = (blocks: PublicBlock[]): PublicBlock[] =>
    blocks.flatMap((block) => {
      const children = block.children ? filter(block.children) : undefined,
        rooms = block.rooms?.map((room) => ({
          ...room,
          blocks: filter(room.blocks),
        }));
      const match =
        (!options.blockIds || options.blockIds.includes(block.id)) &&
        (!options.categoryIds || options.categoryIds.includes(block.category));
      if (
        !match &&
        !children?.length &&
        !rooms?.some((room) => room.blocks.length)
      )
        return [];
      // Containers remain as structural context for selected descendants.
      const next = {
        ...block,
        ...(children ? { children } : {}),
        ...(rooms ? { rooms } : {}),
      };
      if (!match) {
        next.description = undefined;
        next.facilitator = undefined;
        next.fields = {};
      }
      return [next];
    });
  const selected = {
    ...permitted,
    days: permitted.days
      .filter((day) => options.dayIds.includes(day.id))
      .map((day) => ({ ...day, blocks: filter(day.blocks) })),
    columns: permitted.columns
      .filter((column) => options.columnIds.includes(column.id))
      .map((column) => ({ ...column, visibility: "public" as const })),
    pages: permitted.pages
      ?.filter((page) => !options.pageIds || options.pageIds.includes(page.id))
      .map((page) => ({ ...page, visibility: "public" as const })),
  };
  const result: ExportSession = publicProjection(selected);
  const included = new Set(
    result.days.flatMap((day) =>
      allBlocks(day.blocks).map((block) => block.id),
    ),
  );
  result.exportTimings = Object.fromEntries(
    permitted.days
      .flatMap((day) => scheduleTreeDay(day))
      .filter((row) => included.has(row.block.id))
      .map((row) => [
        row.block.id,
        { startMinute: row.startMinute, endMinute: row.endMinute },
      ]),
  );
  if (options.audience === "team") {
    result.description = session.description;
    result.pages = result.pages?.map((page) => ({
      ...page,
      visibility:
        session.pages?.find((source) => source.id === page.id)?.visibility ??
        "team",
    }));
  }
  return result;
}

export function exportMaterials(session: PublicSession) {
  return session.days.flatMap((day) =>
    allBlocks(day.blocks).flatMap((block) =>
      session.columns
        .filter((column) => column.kind === "materials")
        .flatMap((column) =>
          extractMaterials(columnValue(block, column.id)).map((text) => ({
            text,
            block: block.title,
            day: day.title,
          })),
        ),
    ),
  );
}
export interface ExportSlide {
  id: string;
  kind: "title" | "agenda" | "block" | "page" | "form";
  targetId?: string;
  title: string;
  enabled: boolean;
  url?: string;
}
export function defaultSlideOutline(
  session: PublicSession,
  locale: Locale,
): ExportSlide[] {
  return [
    { id: "title", kind: "title", title: session.title, enabled: true },
    ...session.days.flatMap((day) => [
      {
        id: `agenda-${day.id}`,
        kind: "agenda" as const,
        targetId: day.id,
        title: `${locale === "fr" ? "Programme" : "Agenda"} · ${day.title}`,
        enabled: true,
      },
      ...allBlocks(day.blocks).map((block) => ({
        id: `block-${block.id}`,
        kind: "block" as const,
        targetId: block.id,
        title: block.title,
        enabled: true,
      })),
    ]),
    ...(session.pages ?? []).map((page) => ({
      id: `page-${page.id}`,
      kind: "page" as const,
      targetId: page.id,
      title: page.title,
      enabled: true,
    })),
  ];
}
