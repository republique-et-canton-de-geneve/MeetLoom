import { z } from "zod";
import {
  columnSchema,
  soundSchema,
  timezoneSchema,
  timeSchema,
  idSchema,
} from "./validation.js";
import { pageSchema, formSchema } from "./content.js";
import { DEFAULT_CATEGORIES } from "./model.js";

export type WorkspaceRole = "admin" | "editor" | "viewer";
export const workspaceDefaultsSchema = z
  .object({
    editorLayout: z
      .object({ separateDescription: z.boolean(), separateTime: z.boolean() })
      .strict()
      .optional(),
    columns: z.array(columnSchema).max(20).optional(),
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
    pages: z.array(pageSchema).max(30).optional(),
    forms: z.array(formSchema).max(30).optional(),
    sound: soundSchema.optional(),
    timezone: timezoneSchema.optional(),
    startTime: timeSchema.optional(),
    export: z
      .object({ audience: z.enum(["public", "team"]), landscape: z.boolean() })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (value) => JSON.stringify(value).length <= 250000,
    "Workspace defaults are too large",
  )
  .superRefine((value, context) => {
    const ids = new Set<string>();
    for (const [key, items] of [
      ["columns", value.columns ?? []],
      ["categories", value.categories ?? []],
    ] as const)
      for (const [index, item] of items.entries()) {
        if (
          ids.has(item.id) ||
          (key === "categories" &&
            (DEFAULT_CATEGORIES as readonly string[]).includes(item.id))
        )
          context.addIssue({
            code: "custom",
            path: [key, index, "id"],
            message: "Duplicate or reserved identifier",
          });
        ids.add(item.id);
      }
  });
export type WorkspaceDefaults = z.infer<typeof workspaceDefaultsSchema>;
export const workspaceSettingsSchema = z
  .object({
    organization: z.string().trim().max(200).default(""),
    logo: z
      .string()
      .max(120000)
      .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/)
      .optional(),
    defaults: workspaceDefaultsSchema.default({}),
  })
  .strict();
export type WorkspaceSettings = z.infer<typeof workspaceSettingsSchema>;
export interface WorkspaceSummary {
  id: string;
  name: string;
  role: WorkspaceRole | "guest";
  organization: string;
  logo?: string;
  version: number;
}
export interface Workspace extends Omit<
  WorkspaceSummary,
  "role" | "organization" | "logo"
> {
  settings: WorkspaceSettings;
  createdAt: string;
}
export interface WorkspaceMember {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole | "guest";
  sessions: { id: string; title: string; role: string }[];
}
