import type { PrintOptions } from "./export-settings.js";
import type { ExportSlide } from "./export-projection.js";
export interface ExportAiProposal {
  answer: string;
  options: PrintOptions;
  outline: ExportSlide[];
}
