import { z } from "zod";
export const printOptionsSchema = z
  .object({
    paper: z.enum(["A4", "Letter", "Legal"]).default("A4"),
    landscape: z.boolean().default(false),
    font: z.enum(["Arial", "Calibri", "Georgia"]).default("Arial"),
    fontSize: z
      .union([
        z.literal(9),
        z.literal(10),
        z.literal(11),
        z.literal(12),
        z.literal(14),
      ])
      .default(11),
    layout: z
      .enum(["detailed", "table", "compact", "overview", "multiday", "details"])
      .default("detailed"),
    includeMaterials: z.boolean().default(false),
    dayPageBreak: z.boolean().default(true),
    categoryColors: z.boolean().default(true),
    categoryLegend: z.boolean().default(true),
    blocksPerPage: z.number().int().min(0).max(30).default(0),
  })
  .strict();
export type PrintOptions = z.infer<typeof printOptionsSchema>;
export const DEFAULT_PRINT_OPTIONS: PrintOptions = printOptionsSchema.parse({});
export interface ExportPreset {
  id: string;
  name: string;
  audience: "team" | "public";
  options: PrintOptions;
}
