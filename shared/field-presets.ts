import type { Column, Locale } from "./model.js";

export type FieldPreset =
  "goals" | "instructions" | "background" | "materials" | "tasks";
export const FIELD_PRESETS: FieldPreset[] = [
  "goals",
  "instructions",
  "background",
  "materials",
  "tasks",
];
export function fieldPresetLabel(preset: FieldPreset, locale: Locale): string {
  const labels = {
    goals: ["Objectifs", "Goals"],
    instructions: ["Consignes", "Instructions"],
    background: ["Contexte", "Background"],
    materials: ["Matériel", "Materials"],
    tasks: ["Tâches", "Tasks"],
  };
  return labels[preset][locale === "fr" ? 0 : 1];
}
export function createPresetColumn(
  preset: FieldPreset,
  locale: Locale,
): Column {
  return {
    id: crypto.randomUUID(),
    label: fieldPresetLabel(preset, locale),
    kind: preset === "materials" || preset === "tasks" ? preset : "text",
    visibility: "team",
    visible: false,
  };
}
