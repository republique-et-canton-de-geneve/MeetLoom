import type { Locale } from "../shared/model";

export interface CategoryDefinition {
  id: string;
  label: string;
  color: string;
}
const defaults = [
  ["opening", "Ouverture", "Opening", "#84b5a2"],
  ["discussion", "Discussion", "Discussion", "#83abc2"],
  ["activity", "Activité", "Activity", "#ae9cc9"],
  ["break", "Pause", "Break", "#acb681"],
  ["decision", "Décision", "Decision", "#d0ae72"],
  ["closing", "Clôture", "Closing", "#c39191"],
] as const;
export const DEFAULT_CATEGORY_IDS = defaults.map((value) => value[0]);
export function categoriesFor(
  locale: Locale,
  overrides: CategoryDefinition[] = [],
): CategoryDefinition[] {
  const defined = new Map(overrides.map((value) => [value.id, value]));
  return [
    ...defaults.map(
      ([id, fr, en, color]) =>
        defined.get(id) ?? { id, label: locale === "fr" ? fr : en, color },
    ),
    ...overrides.filter(
      (value) =>
        !DEFAULT_CATEGORY_IDS.includes(
          value.id as (typeof DEFAULT_CATEGORY_IDS)[number],
        ),
    ),
  ];
}
export function categoryColor(
  id: string,
  overrides: CategoryDefinition[] = [],
): string {
  return (
    categoriesFor("fr", overrides).find((category) => category.id === id)
      ?.color ?? "#a9b5bc"
  );
}
