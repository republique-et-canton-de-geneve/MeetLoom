import { z } from "zod";
import type { Block, Locale, Session } from "./model.js";
import { allBlocks, mapBlocks, newBlock } from "./domain.js";
import {
  newForm,
  newPage,
  newQuestion,
  orderedContent,
  type FormQuestion,
} from "./content.js";
import { sessionInputSchema } from "./validation.js";

const identifier = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const draftBlock = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(30000).default(""),
    duration: z.number().finite().min(0).max(1440),
    category: z
      .enum([
        "opening",
        "discussion",
        "activity",
        "break",
        "decision",
        "closing",
      ])
      .default("activity"),
    facilitator: z.string().max(200).default(""),
    section: z.string().max(200).default(""),
  })
  .strict();
const changes = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(30000).optional(),
    duration: z.number().finite().min(0).max(1440).optional(),
    category: identifier.optional(),
    facilitator: z.string().max(200).optional(),
    section: z.string().max(200).optional(),
    fields: z
      .record(identifier, z.string().max(30000))
      .refine((value) => Object.keys(value).length <= 20)
      .optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const question = z
  .object({
    type: z.enum([
      "short",
      "long",
      "single",
      "multiple",
      "scale",
      "matrix",
      "image",
    ]),
    title: z.string().min(1).max(200),
    description: z.string().max(30000).default(""),
    required: z.boolean().default(false),
    options: z.array(z.string().min(1).max(300)).min(1).max(30).optional(),
    rows: z.array(z.string().min(1).max(300)).min(1).max(30).optional(),
    min: z.number().int().min(0).max(9).optional(),
    max: z.number().int().min(1).max(10).optional(),
  })
  .strict();
export const aiOperationSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("update_block"), blockId: identifier, changes })
    .strict(),
  z
    .object({
      type: z.literal("add_blocks"),
      dayId: identifier,
      afterBlockId: identifier.optional(),
      blocks: z.array(draftBlock).min(1).max(40),
    })
    .strict(),
  z
    .object({
      type: z.literal("delete_blocks"),
      blockIds: z.array(identifier).min(1).max(100),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_day"),
      dayId: identifier,
      title: z.string().min(1).max(120).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      startTime: z
        .string()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_session"),
      title: z.string().min(1).max(240).optional(),
      description: z.string().max(30000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("create_page"),
      title: z.string().min(1).max(200),
      content: z.string().max(30000),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_page"),
      pageId: identifier,
      title: z.string().min(1).max(200).optional(),
      sections: z
        .array(
          z
            .object({ sectionId: identifier, content: z.string().max(30000) })
            .strict(),
        )
        .max(100)
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("create_form"),
      title: z.string().min(1).max(200),
      description: z.string().max(30000).default(""),
      questions: z.array(question).min(1).max(40),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_form"),
      formId: identifier,
      title: z.string().min(1).max(200).optional(),
      description: z.string().max(30000).optional(),
      questions: z.array(question).min(1).max(40).optional(),
    })
    .strict(),
]);
export type AiOperation = z.infer<typeof aiOperationSchema>;
export const aiProposalSchema = z
  .object({
    answer: z.string().min(1).max(32000),
    operations: z.array(aiOperationSchema).max(100),
  })
  .strict();
export interface AiConversation {
  includePrivate: boolean;
  id: string;
  sessionId: string;
  title: string;
  contextMode: "none" | "current" | "selected" | "workspace" | "all";
  contextIds: string[];
  instructionSetId: string | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
}
export interface AiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  operations?: AiOperation[];
  baseVersion?: number;
  decision?: "pending" | "applied" | "rejected";
}
export interface AiInstructionSet {
  id: string;
  title: string;
  content: string;
  workspaceId?: string | null;
}

/** Explicit operations cannot change permissions, publication state, private column audiences or clocks. */
export function applyAiOperations(
  session: Session,
  operations: AiOperation[],
  locale: Locale,
): Session {
  let result = structuredClone(session);
  for (const operation of operations) {
    if (operation.type === "update_block") {
      const selected = result.days
        .flatMap((day) => allBlocks(day.blocks))
        .find((block) => block.id === operation.blockId);
      if (
        operation.changes.duration !== undefined &&
        selected?.kind &&
        selected.kind !== "activity"
      )
        throw new Error("AI_CONTAINER_DURATION");
      if (
        !result.days.some((day) =>
          allBlocks(day.blocks).some((block) => block.id === operation.blockId),
        )
      )
        throw new Error("AI_TARGET_MISSING");
      result.days = result.days.map((day) => ({
        ...day,
        blocks: mapBlocks(day.blocks, (block) =>
          block.id === operation.blockId
            ? {
                ...block,
                ...operation.changes,
                fields: { ...block.fields, ...operation.changes.fields },
              }
            : block,
        ),
      }));
    } else if (operation.type === "add_blocks") {
      const target = result.days.find((day) => day.id === operation.dayId);
      if (!target) throw new Error("AI_TARGET_MISSING");
      const added = operation.blocks.map((block) => newBlock(locale, block));
      if (operation.afterBlockId) {
        let found = false;
        const insert = (blocks: Block[]): Block[] =>
          blocks.flatMap((block) => {
            const next = {
              ...block,
              ...(block.children ? { children: insert(block.children) } : {}),
              ...(block.rooms
                ? {
                    rooms: block.rooms.map((room) => ({
                      ...room,
                      blocks: insert(room.blocks),
                    })),
                  }
                : {}),
            };
            if (block.id !== operation.afterBlockId) return [next];
            found = true;
            return [next, ...added];
          });
        target.blocks = insert(target.blocks);
        if (!found) throw new Error("AI_TARGET_MISSING");
      } else target.blocks.push(...added);
    } else if (operation.type === "delete_blocks") {
      const known = new Set(
        result.days.flatMap((day) =>
          allBlocks(day.blocks).map((block) => block.id),
        ),
      );
      if (operation.blockIds.some((id) => !known.has(id)))
        throw new Error("AI_TARGET_MISSING");
      const removed = new Set(operation.blockIds),
        remove = (blocks: Block[]): Block[] =>
          blocks
            .filter((block) => !removed.has(block.id))
            .map((block) => ({
              ...block,
              ...(block.children ? { children: remove(block.children) } : {}),
              ...(block.rooms
                ? {
                    rooms: block.rooms.map((room) => ({
                      ...room,
                      blocks: remove(room.blocks),
                    })),
                  }
                : {}),
            }));
      result.days = result.days.map((day) => ({
        ...day,
        blocks: remove(day.blocks),
      }));
    } else if (operation.type === "update_day") {
      if (!result.days.some((day) => day.id === operation.dayId))
        throw new Error("AI_TARGET_MISSING");
      const { type: _type, dayId: _id, ...updates } = operation;
      result.days = result.days.map((day) =>
        day.id === operation.dayId ? { ...day, ...updates } : day,
      );
    } else if (operation.type === "update_session") {
      const { type: _type, ...updates } = operation;
      result = { ...result, ...updates };
    } else if (operation.type === "create_page") {
      const page = newPage(locale);
      page.title = operation.title;
      page.sections[0].content = operation.content;
      result.pages = [...(result.pages ?? []), page];
    } else if (operation.type === "update_page") {
      const page = result.pages?.find((page) => page.id === operation.pageId);
      if (
        !page ||
        operation.sections?.some(
          (section) =>
            !page.sections.some(
              (candidate) => candidate.id === section.sectionId,
            ),
        )
      )
        throw new Error("AI_TARGET_MISSING");
      if (operation.title !== undefined) page.title = operation.title;
      page.sections = page.sections.map((section) => ({
        ...section,
        content:
          operation.sections?.find((value) => value.sectionId === section.id)
            ?.content ?? section.content,
      }));
    } else if (
      operation.type === "create_form" ||
      operation.type === "update_form"
    ) {
      const form =
        operation.type === "create_form"
          ? newForm(locale)
          : result.forms?.find((form) => form.id === operation.formId);
      if (!form) throw new Error("AI_TARGET_MISSING");
      if (operation.title !== undefined) form.title = operation.title;
      if (operation.description !== undefined)
        form.description = operation.description;
      if (operation.questions)
        form.questions = operation.questions.map((draft) => {
          let value = newQuestion(draft.type, locale);
          value = {
            ...value,
            title: draft.title,
            description: draft.description,
            required: draft.required,
          };
          if ("options" in value)
            value = {
              ...value,
              options: (draft.options ?? []).map((label) => ({
                id: crypto.randomUUID(),
                label,
              })),
            };
          if (value.type === "matrix")
            value = {
              ...value,
              rows: (draft.rows ?? []).map((label) => ({
                id: crypto.randomUUID(),
                label,
              })),
            };
          if (value.type === "scale")
            value = { ...value, min: draft.min ?? 1, max: draft.max ?? 5 };
          return value as FormQuestion;
        });
      if (operation.type === "create_form")
        result.forms = [...(result.forms ?? []), form];
    }
  }
  result.days = result.days.map((day) => ({
    ...day,
    blocks: mapBlocks(day.blocks, (block) => block),
  }));
  if (result.contentOrder) result.contentOrder = orderedContent(result);
  return sessionInputSchema.parse(result);
}
