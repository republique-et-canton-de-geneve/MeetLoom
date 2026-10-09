/** The typed text still worth keeping against the saved `value`. Saving
 * normalizes the text (surrounding spaces trimmed, empty folder parts
 * dropped) and the saved copy comes back while someone is still typing: a
 * copy that only differs by that normalization keeps the typed text, so a
 * trailing space or "/" is not lost before the next word. Any other value
 * is a real change from elsewhere, which drops the typed text for good. */
export function typedAgainst(
  typed: string | null,
  value: string,
  normalize: (text: string) => string = (text) => text.trim(),
): string | null {
  return typed !== null && normalize(typed) === normalize(value) ? typed : null;
}

/** What a text field shows while someone types in it (see typedAgainst). */
export function keptText(
  typed: string | null,
  value: string,
  normalize?: (text: string) => string,
): string {
  return typedAgainst(typed, value, normalize) ?? value;
}
