/** Raster form responses are separate from agenda attachments. The wire format
 * is a bounded data URL; stored responses use an opaque content reference. */
export const FORM_IMAGE_MAX_BYTES = 256 * 1024;
export const FORM_IMAGES_TOTAL_BYTES = 512 * 1024;
export function parseFormImage(
  value: unknown,
): { mime: string; base64: string; size: number } | null {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(FORM_IMAGE_MAX_BYTES / 3) * 4 + 40
  )
    return null;
  const match = value.match(
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!match || match[2].length % 4 !== 0) return null;
  try {
    const bytes = atob(match[2]);
    if (
      bytes.length < 12 ||
      bytes.length > FORM_IMAGE_MAX_BYTES ||
      btoa(bytes) !== match[2]
    )
      return null;
    const valid =
      match[1] === "image/png"
        ? bytes.startsWith("\x89PNG\r\n\x1a\n") &&
          bytes.length >= 45 &&
          bytes.slice(-8, -4) === "IEND"
        : match[1] === "image/jpeg"
          ? bytes.startsWith("\xff\xd8\xff") && bytes.endsWith("\xff\xd9")
          : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
    return valid
      ? { mime: match[1], base64: match[2], size: bytes.length }
      : null;
  } catch {
    return null;
  }
}
export function isStoredFormImage(value: unknown): value is string {
  return typeof value === "string" && /^image:[a-f0-9]{64}$/.test(value);
}
