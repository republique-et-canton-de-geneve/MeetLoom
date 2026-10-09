import { useState, type ComponentProps } from "react";
import { typedAgainst } from "./text-input";

/** A text input bound to a saved field that trims or normalizes what it
 * stores. While it has focus it keeps what is typed when the saved copy
 * only differs by that normalization (see typedAgainst). */
export function TextField({
  value,
  change,
  normalize,
  onBlur,
  ...input
}: Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  change: (value: string) => void;
  normalize?: (text: string) => string;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  // A real change from elsewhere drops what was typed, so it cannot come
  // back if the old value returns later.
  const kept = typedAgainst(typed, value, normalize);
  if (kept !== typed) setTyped(kept);
  return (
    <input
      {...input}
      value={kept ?? value}
      onChange={(event) => {
        setTyped(event.target.value);
        change(event.target.value);
      }}
      onBlur={(event) => {
        setTyped(null);
        onBlur?.(event);
      }}
    />
  );
}
