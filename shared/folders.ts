import { z } from "zod";
export const normalizeFolder = (value: string) =>
  value
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
export const folderPathSchema = z
  .string()
  .max(240)
  .transform(normalizeFolder)
  .refine(
    (value) =>
      !!value &&
      value.split("/").length <= 12 &&
      value
        .split("/")
        .every((part) => part.length <= 80 && ![".", ".."].includes(part)) &&
      !/[\u0000-\u001f\\]/.test(value),
    "Invalid folder path",
  );
export const folderAncestors = (path: string) =>
  path
    .split("/")
    .filter(Boolean)
    .map((_, index) =>
      path
        .split("/")
        .slice(0, index + 1)
        .join("/"),
    );
export interface FolderListing {
  version: number;
  folders: string[];
  editable: boolean;
  workspaceId?: string;
}
