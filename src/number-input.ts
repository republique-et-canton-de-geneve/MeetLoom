/** Reads a number typed in a field. Empty, partial or out-of-bounds text is
 * null rather than a value, so the field can be cleared and retyped. */
export function parseNumberInput(
  text: string,
  {
    min,
    max,
    integer = false,
  }: { min: number; max: number; integer?: boolean },
): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  return Number.isFinite(value) &&
    value >= min &&
    value <= max &&
    (!integer || Number.isInteger(value))
    ? value
    : null;
}
