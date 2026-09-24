import { z } from "zod";
import type { Locale, Session, User } from "./model.js";
import { parseFormImage, FORM_IMAGES_TOTAL_BYTES } from "./form-images.js";

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/)
  .refine(
    (value) => !["__proto__", "prototype", "constructor"].includes(value),
  );
const title = z.string().trim().min(1).max(200);
const text = z.string().max(30000);
export const pageSchema = z
  .object({
    id,
    title,
    visibility: z.enum(["team", "public"]),
    sections: z.array(z.object({ id, content: text }).strict()).max(100),
  })
  .strict();
const option = z
  .object({ id, label: z.string().trim().min(1).max(300) })
  .strict();
const base = { id, title, description: text, required: z.boolean() };
export const questionSchema = z.discriminatedUnion("type", [
  z.object({ ...base, type: z.literal("short") }).strict(),
  z.object({ ...base, type: z.literal("long") }).strict(),
  z.object({ ...base, type: z.literal("image") }).strict(),
  z
    .object({
      ...base,
      type: z.literal("single"),
      options: z.array(option).min(1).max(30),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("multiple"),
      options: z.array(option).min(1).max(30),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal("scale"),
      min: z.number().int().min(0).max(10),
      max: z.number().int().min(1).max(10),
      minLabel: z.string().max(100),
      maxLabel: z.string().max(100),
    })
    .strict()
    .refine((value) => value.min < value.max, {
      message: "Invalid scale range",
      path: ["max"],
    }),
  z
    .object({
      ...base,
      type: z.literal("matrix"),
      rows: z.array(option).min(1).max(30),
      options: z.array(option).min(1).max(30),
    })
    .strict(),
]);
export const formSchema = z
  .object({
    id,
    title,
    description: text,
    identityMode: z.enum(["automatic", "optional", "anonymous"]),
    questions: z.array(questionSchema).max(100),
  })
  .strict();
export const contentOrderSchema = z
  .array(z.object({ kind: z.enum(["day", "page", "form"]), id }).strict())
  .max(90);
export type SessionPage = z.infer<typeof pageSchema>;
export type SessionForm = z.infer<typeof formSchema>;
export type FormQuestion = z.infer<typeof questionSchema>;
export type ContentItem = z.infer<typeof contentOrderSchema>[number];
export type Answer = string | string[] | number | Record<string, string>;
export type FormAnswers = Record<string, Answer>;
export interface FormPublication {
  id: string;
  formId: string;
  enabled: boolean;
  revision: number;
  updatedAt: string;
  token?: string;
}
export interface FormResponse {
  id: string;
  formId: string;
  revision: number;
  definition: SessionForm;
  answers: FormAnswers;
  respondent: Pick<User, "id" | "name" | "email"> | null;
  createdAt: string;
}
export interface PublicFormData {
  form: SessionForm;
  sessionTitle: string;
  revision: number;
  identity: Pick<User, "name" | "email"> | null;
}

export function newPage(locale: Locale): SessionPage {
  return {
    id: crypto.randomUUID(),
    title: locale === "fr" ? "Nouvelle page" : "New page",
    visibility: "team",
    sections: [{ id: crypto.randomUUID(), content: "" }],
  };
}
export function newForm(locale: Locale): SessionForm {
  return {
    id: crypto.randomUUID(),
    title: locale === "fr" ? "Nouveau formulaire" : "New form",
    description: "",
    identityMode: "automatic",
    questions: [],
  };
}
export function newQuestion(
  type: FormQuestion["type"],
  locale: Locale,
): FormQuestion {
  const common = {
    id: crypto.randomUUID(),
    title: locale === "fr" ? "Nouvelle question" : "New question",
    description: "",
    required: false,
  };
  const choices = () =>
    [1, 2].map((index) => ({
      id: crypto.randomUUID(),
      label: `${locale === "fr" ? "Choix" : "Choice"} ${index}`,
    }));
  if (type === "single" || type === "multiple")
    return { ...common, type, options: choices() };
  if (type === "matrix")
    return {
      ...common,
      type,
      rows: [
        {
          id: crypto.randomUUID(),
          label: locale === "fr" ? "Aspect à évaluer" : "Aspect to evaluate",
        },
      ],
      options: choices(),
    };
  if (type === "scale")
    return { ...common, type, min: 1, max: 5, minLabel: "", maxLabel: "" };
  return { ...common, type };
}
export function orderedContent(session: {
  days: { id: string }[];
  pages?: { id: string }[];
  forms?: { id: string }[];
  contentOrder?: ContentItem[];
}): ContentItem[] {
  const all: ContentItem[] = [
    ...session.days.map((day) => ({ kind: "day" as const, id: day.id })),
    ...(session.pages ?? []).map((page) => ({
      kind: "page" as const,
      id: page.id,
    })),
    ...(session.forms ?? []).map((form) => ({
      kind: "form" as const,
      id: form.id,
    })),
  ];
  const available = new Map(
    all.map((item) => [`${item.kind}:${item.id}`, item]),
  );
  const ordered: ContentItem[] = [];
  for (const item of session.contentOrder ?? []) {
    const key = `${item.kind}:${item.id}`;
    if (available.has(key)) {
      ordered.push(item);
      available.delete(key);
    }
  }
  return [...ordered, ...available.values()];
}
export function pageProjection(pages: SessionPage[] = []): SessionPage[] {
  return pages
    .filter((page) => page.visibility === "public")
    .map((page) => ({
      id: page.id,
      title: page.title,
      visibility: "public",
      sections: page.sections.map((section) => ({
        id: section.id,
        content: section.content,
      })),
    }));
}
export function contentIds(session: {
  pages?: SessionPage[];
  forms?: SessionForm[];
}): string[] {
  return [
    ...(session.pages ?? []).flatMap((page) => [
      page.id,
      ...page.sections.map((section) => section.id),
    ]),
    ...(session.forms ?? []).flatMap((form) => [
      form.id,
      ...form.questions.flatMap((question) => [
        question.id,
        ...("options" in question
          ? question.options.map((value) => value.id)
          : []),
        ...("rows" in question ? question.rows.map((value) => value.id) : []),
      ]),
    ]),
  ];
}
export function cloneContent(
  session: Pick<Session, "pages" | "forms" | "contentOrder">,
  dayIds: Map<string, string> = new Map(),
  forcePrivate = false,
  freshId: () => string = () => crypto.randomUUID(),
) {
  const ids = new Map(dayIds);
  const fresh = (old: string): string => {
    const next = freshId();
    ids.set(old, next);
    return next;
  };
  const pages = session.pages?.map((page) => ({
    ...page,
    id: fresh(page.id),
    visibility: forcePrivate ? ("team" as const) : page.visibility,
    sections: page.sections.map((section) => ({
      ...section,
      id: fresh(section.id),
    })),
  }));
  const forms = session.forms?.map((form) => ({
    ...form,
    id: fresh(form.id),
    questions: form.questions.map((question) => ({
      ...question,
      id: fresh(question.id),
      ...("options" in question
        ? {
            options: question.options.map((option) => ({
              ...option,
              id: fresh(option.id),
            })),
          }
        : {}),
      ...("rows" in question
        ? { rows: question.rows.map((row) => ({ ...row, id: fresh(row.id) })) }
        : {}),
    })) as FormQuestion[],
  }));
  const contentOrder = session.contentOrder?.flatMap((item) =>
    ids.has(item.id) ? [{ ...item, id: ids.get(item.id)! }] : [],
  );
  return {
    ...(pages ? { pages } : {}),
    ...(forms ? { forms } : {}),
    ...(contentOrder ? { contentOrder } : {}),
  };
}
export function validateFormAnswers(
  form: SessionForm,
  input: unknown,
): { answers: FormAnswers; errors: Record<string, string> } {
  const answers: FormAnswers = {},
    errors: Record<string, string> = {};
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { answers, errors: { _form: "INVALID_ANSWERS" } };
  const raw = input as Record<string, unknown>,
    known = new Set(form.questions.map((question) => question.id));
  let imageBytes = 0;
  if (Object.keys(raw).some((key) => !known.has(key)))
    errors._form = "UNKNOWN_QUESTION";
  for (const question of form.questions) {
    const value = Object.hasOwn(raw, question.id)
      ? raw[question.id]
      : undefined;
    const empty =
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && !value.length) ||
      (!!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !Object.keys(value).length);
    if (empty) {
      if (question.required) errors[question.id] = "REQUIRED";
      continue;
    }
    if (question.type === "image") {
      const image = parseFormImage(value);
      if (!image || (imageBytes += image.size) > FORM_IMAGES_TOTAL_BYTES)
        errors[question.id] = "INVALID_IMAGE";
      else answers[question.id] = value as string;
    } else if (question.type === "short" || question.type === "long") {
      if (
        typeof value !== "string" ||
        value.length > (question.type === "short" ? 1000 : 10000) ||
        (question.required && !value.trim())
      )
        errors[question.id] = "INVALID_TEXT";
      else answers[question.id] = value;
    } else if (question.type === "single") {
      if (
        typeof value !== "string" ||
        !question.options.some((option) => option.id === value)
      )
        errors[question.id] = "INVALID_CHOICE";
      else answers[question.id] = value;
    } else if (question.type === "multiple") {
      if (
        !Array.isArray(value) ||
        value.length > question.options.length ||
        new Set(value).size !== value.length ||
        value.some(
          (item) =>
            typeof item !== "string" ||
            !question.options.some((option) => option.id === item),
        )
      )
        errors[question.id] = "INVALID_CHOICE";
      else answers[question.id] = value as string[];
    } else if (question.type === "scale") {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value < question.min ||
        value > question.max
      )
        errors[question.id] = "INVALID_SCALE";
      else answers[question.id] = value;
    } else {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).some(
          (key) => !question.rows.some((row) => row.id === key),
        )
      ) {
        errors[question.id] = "INVALID_MATRIX";
        continue;
      }
      const matrix = value as Record<string, unknown>;
      if (
        Object.values(matrix).some(
          (choice) =>
            typeof choice !== "string" ||
            !question.options.some((option) => option.id === choice),
        ) ||
        (question.required &&
          question.rows.some((row) => !Object.hasOwn(matrix, row.id)))
      )
        errors[question.id] = "INVALID_MATRIX";
      else
        answers[question.id] = Object.fromEntries(
          Object.entries(matrix),
        ) as Record<string, string>;
    }
  }
  return { answers, errors };
}
