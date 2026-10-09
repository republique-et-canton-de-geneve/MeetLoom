/** What a text field shows while someone types in it. Saving normalizes the
 * text (surrounding spaces trimmed, empty folder parts dropped) and the
 * saved copy comes back while they are still typing: a copy that only
 * differs by that normalization keeps the typed text, so a trailing space or
 * "/" is not lost before the next word. Any other value is a real change. */
export function keptText(
  typed: string | null,
  value: string,
  normalize: (text: string) => string = (text) => text.trim(),
): string {
  return typed !== null && normalize(typed) === normalize(value)
    ? typed
    : value;
}
