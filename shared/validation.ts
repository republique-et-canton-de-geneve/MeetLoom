import { z } from "zod";
import { folderPathSchema } from "./folders.js";
import {
  DEFAULT_CATEGORIES,
  type Block,
  type SessionCategory,
} from "./model.js";
import { blockDuration, runnableBlocks } from "./domain.js";
import {
  contentIds,
  contentOrderSchema,
  formSchema,
  pageSchema,
  type ContentItem,
  type SessionForm,
  type SessionPage,
} from "./content.js";

const unsafeKeys = new Set(["__proto__", "prototype", "constructor"]);
// Validate raw keys before z.record normalizes input (it drops __proto__). A
// malformed import is rejected explicitly rather than silently rewritten.
const safeRecordKeys = z.unknown().superRefine((value, context) => {
  if (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).some((key) => unsafeKeys.has(key))
  ) {
    context.addIssue({ code: "custom", message: "Reserved object key" });
  }
});
export const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
  .refine((value) => !unsafeKeys.has(value), "Reserved identifier");
export const timeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  }, "Invalid date");
export const timezoneSchema = z
  .string()
  .min(1)
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid timezone");
const timestampSchema = z.number().finite().min(0).max(8640000000000000);
const isoSchema = z.string().datetime({ offset: true });

export const columnSchema = z
  .object({
    id: idSchema,
    kind: z.enum(["text", "materials", "tasks"]).optional(),
    label: z.string().trim().min(1).max(80),
    visibility: z.enum(["team", "public"]),
    visible: z.boolean(),
  })
  .strict();

const rawBlockSchema: z.ZodType<Block> = z.lazy(() =>
  z
    .object({
      id: idSchema,
      kind: z.enum(["activity", "note", "group", "parallel"]).optional(),
      children: z.array(rawBlockSchema).max(1000).optional(),
      rooms: z
        .array(
          z
            .object({
              id: idSchema,
              title: z.string().trim().min(1).max(120),
              blocks: z.array(rawBlockSchema).max(1000),
            })
            .strict(),
        )
        .max(12)
        .optional(),
      title: z.string().trim().min(1).max(240),
      description: z.string().max(30_000),
      duration: z.number().finite().min(0).max(1440),
      category: idSchema,
      facilitator: z.string().max(240),
      assignees: z
        .array(
          z
            .object({ id: idSchema, name: z.string().trim().min(1).max(120) })
            .strict(),
        )
        .max(20)
        .refine(
          (values) =>
            new Set(values.map((value) => value.id)).size === values.length,
          "Duplicate assignee",
        )
        .optional(),
      section: z.string().max(240),
      fields: safeRecordKeys
        .pipe(z.record(idSchema, z.string().max(30_000)))
        .refine((value) => Object.keys(value).length <= 20, "Too many fields"),
      lockedStart: timeSchema.optional(),
    })
    .strict()
    .superRefine((block, context) => {
      if (block.children !== undefined && block.kind !== "group")
        context.addIssue({
          code: "custom",
          path: ["children"],
          message: "Only groups have children",
        });
      if (block.rooms !== undefined && block.kind !== "parallel")
        context.addIssue({
          code: "custom",
          path: ["rooms"],
          message: "Only parallel blocks have rooms",
        });
      if (block.kind === "group" && !block.children)
        context.addIssue({
          code: "custom",
          path: ["children"],
          message: "A group requires its child list",
        });
      if (block.kind === "parallel" && !block.rooms)
        context.addIssue({
          code: "custom",
          path: ["rooms"],
          message: "A parallel block requires its room list",
        });
      if (blockDuration(block) > 1440)
        context.addIssue({
          code: "custom",
          path: ["duration"],
          message: "Block exceeds 24 hours",
        });
    })
    .transform((block) => ({ ...block, duration: blockDuration(block) })),
);

/** Bound recursion before invoking Zod's recursive parser, including cyclic
 * in-memory imports. The session validator also counts across all root trees. */
export const blockSchema = z.preprocess((value, context) => {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 1 }];
  const seen = new WeakSet<object>();
  let count = 0;
  while (stack.length) {
    const entry = stack.pop()!;
    if (!entry.value || typeof entry.value !== "object") continue;
    if (entry.depth > 5 || ++count > 1000 || seen.has(entry.value)) {
      context.addIssue({
        code: "custom",
        message: "Tree exceeds depth 5 or 1000 blocks, or contains a cycle",
      });
      return z.NEVER;
    }
    seen.add(entry.value);
    const node = entry.value as { children?: unknown; rooms?: unknown };
    if (Array.isArray(node.children))
      for (const child of node.children)
        stack.push({ value: child, depth: entry.depth + 1 });
    if (Array.isArray(node.rooms))
      for (const room of node.rooms) {
        if (room && typeof room === "object" && Array.isArray(room.blocks))
          for (const child of room.blocks)
            stack.push({ value: child, depth: entry.depth + 1 });
      }
  }
  return value;
}, rawBlockSchema);

const daySchema = z
  .object({
    id: idSchema,
    title: z.string().trim().min(1).max(120),
    date: dateSchema,
    startTime: timeSchema,
    blocks: z.array(blockSchema).max(1000),
  })
  .strict();

export const soundSchema = z
  .object({
    enabled: z.boolean(),
    mode: z.enum(["minutes", "percent"]),
    value: z.number().finite().positive(),
    atEnd: z.boolean(),
    volume: z.number().finite().min(0).max(1),
    sound: z.enum(["bell", "soft", "digital"]),
  })
  .strict()
  .superRefine((sound, context) => {
    if (sound.value > (sound.mode === "percent" ? 99 : 1440))
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Warning outside valid range",
      });
  });

export const runSchema = z
  .object({
    status: z.enum(["idle", "running", "paused", "finished"]),
    dayId: idSchema,
    blockId: idSchema.nullable(),
    startedAt: timestampSchema.nullable(),
    elapsedBeforePause: z.number().finite().min(0).max(100_000_000),
    runStartedAt: timestampSchema.nullable(),
    completedDuration: z.number().finite().min(0).max(100_000_000),
    autoAdvance: z.boolean(),
    revision: z.number().int().min(0),
    lastAutoAdvance: z
      .object({
        blockId: idSchema,
        elapsed: z.number().finite().min(0).max(100_000_000),
        actualBefore: z.number().finite().min(0).max(100_000_000),
        completedBefore: z.number().finite().min(0).max(100_000_000),
        endedAt: timestampSchema,
      })
      .strict()
      .optional(),
    plannedDurations: safeRecordKeys
      .pipe(z.record(idSchema, z.number().finite().min(0).max(86_400)))
      .refine(
        (value) => Object.keys(value).length <= 1000,
        "Too many planned durations",
      )
      .optional(),
    plannedTotal: z.number().finite().min(0).max(100_000_000).optional(),
    actualDurations: safeRecordKeys
      .pipe(z.record(idSchema, z.number().finite().min(0).max(100_000_000)))
      .refine(
        (value) => Object.keys(value).length <= 1000,
        "Too many actual durations",
      )
      .optional(),
  })
  .strict();

const editableShape = {
  editorLayout: z
    .object({ separateDescription: z.boolean(), separateTime: z.boolean() })
    .strict()
    .optional(),
  pages: z.array(pageSchema).max(30).optional(),
  forms: z.array(formSchema).max(30).optional(),
  contentOrder: contentOrderSchema.optional(),
  title: z.string().trim().min(1).max(240),
  description: z.string().max(30_000),
  client: z.string().trim().max(240).optional(),
  tags: z
    .array(z.string().trim().min(1).max(80))
    .max(20)
    .refine((tags) => new Set(tags).size === tags.length, "Duplicate tag")
    .optional(),
  folder: z.union([z.literal(""), folderPathSchema]).optional(),
  categories: z
    .array(
      z
        .object({
          id: idSchema,
          label: z.string().trim().min(1).max(80),
          color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        })
        .strict(),
    )
    .max(30)
    .optional(),
  timezone: timezoneSchema,
  days: z.array(daySchema).min(1).max(30),
  columns: z.array(columnSchema).max(20),
  sound: soundSchema,
  archived: z.boolean(),
};

type AgendaInput = {
  pages?: SessionPage[];
  forms?: SessionForm[];
  contentOrder?: ContentItem[];
  days: z.infer<typeof daySchema>[];
  columns: z.infer<typeof columnSchema>[];
  title: string;
  description: string;
  categories?: SessionCategory[];
};
function validateAgenda(value: AgendaInput, context: z.RefinementCtx): void {
  const ids = new Set<string>();
  const claim = (id: string, path: (string | number)[]) => {
    if (ids.has(id))
      context.addIssue({
        code: "custom",
        path,
        message: "Duplicate identifier",
      });
    ids.add(id);
  };
  const customColumns = new Set(
    value.columns
      .filter((column) => !["description", "facilitator"].includes(column.id))
      .map((column) => column.id),
  );
  value.columns.forEach((column, index) =>
    claim(column.id, ["columns", index, "id"]),
  );
  const categories = new Set<string>(DEFAULT_CATEGORIES);
  value.categories?.forEach((category, index) => {
    if (categories.has(category.id))
      context.addIssue({
        code: "custom",
        path: ["categories", index, "id"],
        message: "Duplicate or built-in category identifier",
      });
    categories.add(category.id);
    claim(category.id, ["categories", index, "id"]);
  });
  let blocks = 0;
  let characters = value.title.length + value.description.length;
  contentIds(value).forEach((identifier) =>
    claim(identifier, ["content", identifier]),
  );
  characters +=
    JSON.stringify(value.pages ?? []).length +
    JSON.stringify(value.forms ?? []).length;
  const destinations = new Set([
    ...value.days.map((day) => `day:${day.id}`),
    ...(value.pages ?? []).map((page) => `page:${page.id}`),
    ...(value.forms ?? []).map((form) => `form:${form.id}`),
  ]);
  const ordered = new Set<string>();
  value.contentOrder?.forEach((item, index) => {
    const key = `${item.kind}:${item.id}`;
    if (!destinations.has(key) || ordered.has(key))
      context.addIssue({
        code: "custom",
        path: ["contentOrder", index],
        message: "Unknown or duplicate content destination",
      });
    ordered.add(key);
  });
  const visit = (block: Block, path: (string | number)[]) => {
    blocks++;
    claim(block.id, [...path, "id"]);
    if (!categories.has(block.category))
      context.addIssue({
        code: "custom",
        path: [...path, "category"],
        message: "Unknown session category",
      });
    characters +=
      block.title.length +
      block.description.length +
      block.facilitator.length +
      block.section.length;
    for (const [key, content] of Object.entries(block.fields)) {
      characters += content.length;
      if (!customColumns.has(key))
        context.addIssue({
          code: "custom",
          path: [...path, "fields", key],
          message: "Field has no custom column",
        });
    }
    block.children?.forEach((child, index) =>
      visit(child, [...path, "children", index]),
    );
    block.rooms?.forEach((room, roomIndex) => {
      claim(room.id, [...path, "rooms", roomIndex, "id"]);
      characters += room.title.length;
      room.blocks.forEach((child, index) =>
        visit(child, [...path, "rooms", roomIndex, "blocks", index]),
      );
    });
  };
  value.days.forEach((day, dayIndex) => {
    claim(day.id, ["days", dayIndex, "id"]);
    characters += day.title.length;
    day.blocks.forEach((block, blockIndex) => {
      const path = ["days", dayIndex, "blocks", blockIndex];
      visit(block, path);
    });
  });
  if (blocks > 1000)
    context.addIssue({
      code: "custom",
      path: ["days"],
      message: "Session exceeds 1000 blocks",
    });
  if (characters > 1_000_000)
    context.addIssue({
      code: "custom",
      path: ["days"],
      message: "Session content too large",
    });
}

/** For PUT: excludes all server-owned identity, revision and running-state values. */
export const editableSessionSchema = z
  .object(editableShape)
  .strict()
  .superRefine(validateAgenda);

/** Full persisted/imported document. API still supplies identity, version and run itself. */
export const sessionInputSchema = z
  .object({
    ...editableShape,
    id: idSchema,
    ownerId: idSchema,
    workspaceId: idSchema.optional(),
    lifecycle: z
      .object({
        closedAt: isoSchema,
        facilitatorIds: z.array(idSchema).max(50),
      })
      .strict()
      .optional(),
    run: runSchema,
    version: z.number().int().min(1),
    createdAt: isoSchema,
    updatedAt: isoSchema,
  })
  .strict()
  .superRefine((session, context) => {
    validateAgenda(session, context);
    const day = session.days.find(
      (candidate) => candidate.id === session.run.dayId,
    );
    if (!day)
      context.addIssue({
        code: "custom",
        path: ["run", "dayId"],
        message: "Unknown running day",
      });
    if (
      session.run.blockId !== null &&
      !runnableBlocks(day?.blocks ?? []).some(
        (block) => block.id === session.run.blockId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["run", "blockId"],
        message: "Unknown running block",
      });
    }
    if (
      session.run.status === "running" &&
      (session.run.startedAt === null ||
        session.run.runStartedAt === null ||
        session.run.blockId === null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["run"],
        message: "Running state requires start times and block",
      });
    }
    if (session.run.status !== "running" && session.run.startedAt !== null)
      context.addIssue({
        code: "custom",
        path: ["run", "startedAt"],
        message: "Inactive clock must be stopped",
      });
  });

export type EditableSessionInput = z.infer<typeof editableSessionSchema>;
